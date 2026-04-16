// OneBox privileged helper — launchd-spawned root daemon that exposes a
// capability-limited XPC interface to the main OneBox app.
//
// Every connection is validated against a hard-coded designated requirement
// before any method is allowed to run: the caller's audit_token_t is resolved
// to a SecCode and checked against the Developer ID signature of
// `cloud.oneoh.onebox` by Team `GN2W3N34TM`. Any other local process —
// including an unsigned binary, a different Team ID, or a stripped/tampered
// copy of OneBox — is rejected at the listener level.
//
// The Info.plist SMAuthorizedClients entry is the install-time gate
// (SMJobBless refuses to bless a helper whose embedded SMAuthorizedClients
// list doesn't include the caller's DR). The runtime check here is the
// per-connection gate — both are required, because SMJobBless validates
// "can this app install me" while the listener validates "can this peer
// call me right now".
//
// Beyond `ping`, the helper now exposes a small set of capability methods
// used to replace the old `echo 'PASSWORD' | sudo -S ...` call sites in
// src/vpn/macos.rs. Every method has hard-coded parameter validation to
// keep the attack surface minimal even if the signature gate were somehow
// bypassed:
//
//   - startSingBox: config path must live under the caller's Application
//     Support directory; the sing-box binary path is derived from the
//     caller's SecCode bundle, never passed by the caller.
//   - stopSingBox / reloadSingBox: operate only on the pid the helper
//     itself spawned, never an arbitrary pid.
//   - setDnsServers: service name restricted to [A-Za-z0-9 _-], dns spec
//     must be either "empty" or a space-separated list of valid IPs.
//   - removeTunRoutes: interface name must match /^utun[0-9]+$/.
//   - setIpForwarding: boolean, no injection surface.
//   - flushDnsCache: no parameters.
//
// Process exit notifications flow back to the client over the same
// NSXPCConnection via a bidirectional XPC interface
// (OneBoxHelperClientProtocol), so the main app can trigger its existing
// process-termination handler without polling.

#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <bsm/libbsm.h>
#include <arpa/inet.h>
#include <dispatch/dispatch.h>
#include <fcntl.h>
#include <signal.h>
#include <spawn.h>
#include <sys/event.h>
#include <sys/stat.h>
#include <sys/sysctl.h>
#include <sys/wait.h>
#include <unistd.h>

// NSXPCConnection has an undocumented but ABI-stable `auditToken` property
// since macOS 10.10. Apple's own EvenBetterAuthorizationSample relies on
// exactly this access pattern; there is no public alternative that returns
// the full audit_token_t needed by SecCodeCopyGuestWithAttributes.
@interface NSXPCConnection (OneBoxPrivate)
@property (nonatomic, readonly) audit_token_t auditToken;
@end

@protocol OneBoxHelperProtocol
- (void)pingWithReply:(void (^)(NSString *reply))reply;

- (void)startSingBoxWithConfigPath:(NSString *)configPath
                              reply:(void (^)(int pid, NSString *error))reply;

- (void)stopSingBoxWithReply:(void (^)(NSString *error))reply;

- (void)reloadSingBoxWithReply:(void (^)(NSString *error))reply;

- (void)setIpForwarding:(BOOL)enable
                  reply:(void (^)(NSString *error))reply;

- (void)setDnsServersForService:(NSString *)serviceName
                            spec:(NSString *)dnsSpec
                           reply:(void (^)(NSString *error))reply;

- (void)flushDnsCacheWithReply:(void (^)(NSString *error))reply;

- (void)removeTunRoutesForInterface:(NSString *)interfaceName
                               reply:(void (^)(NSString *error))reply;
@end

// Helper → Client direction. The main app exports an object conforming to
// this protocol so the helper can push process-exit events without polling.
@protocol OneBoxHelperClientProtocol
- (void)singBoxDidExitWithPid:(int)pid exitCode:(int)exitCode;
@end

// ============================================================================
// Caller validation
// ============================================================================

// Must match what gets merged into the main app's Info.plist
// (src-tauri/Info.privileged-helper.plist -> SMPrivilegedExecutables) and
// the signing identity used by scripts/sign-helper.sh. Drift between
// these three places fails closed (reject all connections).
static NSString *const kClientRequirement =
    @"identifier \"cloud.oneoh.onebox\" and anchor apple generic and "
    @"certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and "
    @"certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and "
    @"certificate leaf[subject.OU] = \"GN2W3N34TM\"";

static SecCodeRef copyClientSecCode(NSXPCConnection *connection) {
    audit_token_t token = connection.auditToken;

    CFDataRef tokenData = CFDataCreate(NULL, (const UInt8 *)&token, sizeof(token));
    if (tokenData == NULL) {
        return NULL;
    }

    const void *keys[] = { kSecGuestAttributeAudit };
    const void *values[] = { tokenData };
    CFDictionaryRef attrs = CFDictionaryCreate(
        NULL, keys, values, 1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    CFRelease(tokenData);
    if (attrs == NULL) {
        return NULL;
    }

    SecCodeRef code = NULL;
    OSStatus status =
        SecCodeCopyGuestWithAttributes(NULL, attrs, kSecCSDefaultFlags, &code);
    CFRelease(attrs);
    if (status != errSecSuccess) {
        if (code) CFRelease(code);
        return NULL;
    }
    return code;
}

static BOOL validateClient(NSXPCConnection *connection) {
    SecCodeRef code = copyClientSecCode(connection);
    if (code == NULL) {
        NSLog(@"[helper] reject: failed to resolve audit token to SecCode");
        return NO;
    }

    SecRequirementRef requirement = NULL;
    OSStatus status = SecRequirementCreateWithString(
        (__bridge CFStringRef)kClientRequirement, kSecCSDefaultFlags, &requirement);
    if (status != errSecSuccess || requirement == NULL) {
        NSLog(@"[helper] reject: SecRequirementCreateWithString failed: %d", (int)status);
        CFRelease(code);
        if (requirement) CFRelease(requirement);
        return NO;
    }

    status = SecCodeCheckValidity(code, kSecCSDefaultFlags, requirement);
    CFRelease(code);
    CFRelease(requirement);

    if (status != errSecSuccess) {
        NSLog(@"[helper] reject: SecCodeCheckValidity failed: %d", (int)status);
        return NO;
    }

    return YES;
}

// Derive the absolute path to the caller's bundled sing-box binary from
// their SecCode. The main app is always at <bundle>/Contents/MacOS/OneBox,
// so sing-box lives at <bundle>/Contents/MacOS/sing-box. Returning the
// binary by caller lookup (instead of accepting a path parameter) eliminates
// a whole class of "make helper run arbitrary binary" injection attacks.
static NSString *copyCallerSingBoxPath(NSXPCConnection *connection) {
    SecCodeRef code = copyClientSecCode(connection);
    if (code == NULL) {
        return nil;
    }

    SecStaticCodeRef staticCode = NULL;
    OSStatus status = SecCodeCopyStaticCode(code, kSecCSDefaultFlags, &staticCode);
    CFRelease(code);
    if (status != errSecSuccess || staticCode == NULL) {
        NSLog(@"[helper] SecCodeCopyStaticCode failed: %d", (int)status);
        return nil;
    }

    CFURLRef bundleURL = NULL;
    status = SecCodeCopyPath(staticCode, kSecCSDefaultFlags, &bundleURL);
    CFRelease(staticCode);
    if (status != errSecSuccess || bundleURL == NULL) {
        NSLog(@"[helper] SecCodeCopyPath failed: %d", (int)status);
        if (bundleURL) CFRelease(bundleURL);
        return nil;
    }

    NSURL *url = (__bridge_transfer NSURL *)bundleURL;
    NSString *sidecar = [url.path stringByAppendingPathComponent:@"Contents/MacOS/sing-box"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:sidecar]) {
        NSLog(@"[helper] derived sing-box path does not exist: %@", sidecar);
        return nil;
    }
    return sidecar;
}

// ============================================================================
// Parameter validation
// ============================================================================

// Config path must be absolute, end with .json, exist on disk, and live
// inside a user's Application Support directory for our bundle id. This
// prevents the caller from asking us to run an arbitrary config file as
// root (e.g. /etc/passwd) or a path with `../` traversal.
static NSString *validateConfigPath(NSString *path) {
    if (path.length == 0) return @"config path is empty";
    if (![path isAbsolutePath]) return @"config path must be absolute";
    if (![path.pathExtension isEqualToString:@"json"]) return @"config path must end with .json";
    if ([path rangeOfString:@"/../"].location != NSNotFound) return @"config path must not contain /../";
    if ([path rangeOfString:@"/Library/Application Support/cloud.oneoh.onebox/"].location == NSNotFound) {
        return @"config path must be under ~/Library/Application Support/cloud.oneoh.onebox/";
    }
    BOOL isDir = NO;
    if (![[NSFileManager defaultManager] fileExistsAtPath:path isDirectory:&isDir] || isDir) {
        return @"config file does not exist";
    }
    return nil;
}

static NSString *validateServiceName(NSString *name) {
    if (name.length == 0 || name.length > 64) return @"service name length out of range";
    static NSCharacterSet *allowed = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        allowed = [NSCharacterSet characterSetWithCharactersInString:
            @"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 _-"];
    });
    if ([name rangeOfCharacterFromSet:[allowed invertedSet]].location != NSNotFound) {
        return @"service name contains forbidden characters";
    }
    return nil;
}

static NSString *validateInterfaceName(NSString *name) {
    if (![name hasPrefix:@"utun"] || name.length < 5 || name.length > 10) {
        return @"interface must match ^utun[0-9]+$";
    }
    NSCharacterSet *digits = [NSCharacterSet decimalDigitCharacterSet];
    NSString *suffix = [name substringFromIndex:4];
    if ([suffix rangeOfCharacterFromSet:[digits invertedSet]].location != NSNotFound) {
        return @"interface must match ^utun[0-9]+$";
    }
    return nil;
}

static BOOL isValidIpLiteral(NSString *s) {
    struct in_addr v4;
    struct in6_addr v6;
    return inet_pton(AF_INET, s.UTF8String, &v4) == 1 ||
           inet_pton(AF_INET6, s.UTF8String, &v6) == 1;
}

static NSString *validateDnsSpec(NSString *spec) {
    if (spec.length == 0) return @"dns spec is empty";
    if ([spec isEqualToString:@"empty"]) return nil;
    NSArray<NSString *> *parts = [spec componentsSeparatedByCharactersInSet:
        [NSCharacterSet whitespaceCharacterSet]];
    BOOL any = NO;
    for (NSString *p in parts) {
        if (p.length == 0) continue;
        any = YES;
        if (!isValidIpLiteral(p)) {
            return [NSString stringWithFormat:@"invalid IP in dns spec: %@", p];
        }
    }
    if (!any) return @"dns spec has no entries";
    return nil;
}

// ============================================================================
// Shell-out helper (for commands where re-implementing via syscall is overkill)
// ============================================================================

static NSString *runTool(NSString *tool, NSArray<NSString *> *args) {
    NSTask *task = [[NSTask alloc] init];
    task.launchPath = tool;
    task.arguments = args;
    task.standardInput = [NSFileHandle fileHandleWithNullDevice];
    NSPipe *outPipe = [NSPipe pipe];
    NSPipe *errPipe = [NSPipe pipe];
    task.standardOutput = outPipe;
    task.standardError = errPipe;
    @try {
        [task launch];
        [task waitUntilExit];
    } @catch (NSException *ex) {
        return [NSString stringWithFormat:@"%@ launch failed: %@", tool, ex.reason];
    }
    if (task.terminationStatus != 0) {
        NSData *errData = [errPipe.fileHandleForReading readDataToEndOfFile];
        NSString *err = [[NSString alloc] initWithData:errData encoding:NSUTF8StringEncoding];
        return [NSString stringWithFormat:@"%@ exit=%d: %@",
                tool, task.terminationStatus, err ?: @"(no stderr)"];
    }
    return nil;
}

// ============================================================================
// Service
// ============================================================================

@interface HelperService : NSObject <NSXPCListenerDelegate, OneBoxHelperProtocol>
@end

@implementation HelperService {
    dispatch_queue_t _stateQueue;
    pid_t _activePid;
    dispatch_source_t _exitSource;
    // Weak ref to the connection that started sing-box, used to push the
    // exit event back to the correct client. Reset on disconnect or exit.
    __weak NSXPCConnection *_activeConnection;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _stateQueue = dispatch_queue_create("cloud.oneoh.onebox.helper.state", DISPATCH_QUEUE_SERIAL);
    }
    return self;
}

- (BOOL)listener:(NSXPCListener *)listener
    shouldAcceptNewConnection:(NSXPCConnection *)newConnection {
    if (!validateClient(newConnection)) {
        NSLog(@"[helper] connection rejected pid=%d", newConnection.processIdentifier);
        return NO;
    }
    NSLog(@"[helper] connection accepted pid=%d", newConnection.processIdentifier);

    newConnection.exportedInterface =
        [NSXPCInterface interfaceWithProtocol:@protocol(OneBoxHelperProtocol)];
    newConnection.exportedObject = self;

    // Bidirectional: client exports an OneBoxHelperClientProtocol object so
    // the helper can push exit events. If the client doesn't bother setting
    // remoteObjectInterface, proxy calls silently no-op — which is fine for
    // callers that never use startSingBox.
    newConnection.remoteObjectInterface =
        [NSXPCInterface interfaceWithProtocol:@protocol(OneBoxHelperClientProtocol)];

    [newConnection resume];
    return YES;
}

// ------------------------------------------------------------------
// ping
// ------------------------------------------------------------------
- (void)pingWithReply:(void (^)(NSString *))reply {
    reply([NSString stringWithFormat:@"pong pid=%d uid=%d", getpid(), getuid()]);
}

// ------------------------------------------------------------------
// startSingBox
// ------------------------------------------------------------------
- (void)startSingBoxWithConfigPath:(NSString *)configPath
                              reply:(void (^)(int pid, NSString *error))reply {
    NSString *validationError = validateConfigPath(configPath);
    if (validationError) {
        reply(0, validationError);
        return;
    }

    NSXPCConnection *conn = [NSXPCConnection currentConnection];
    if (conn == nil) {
        reply(0, @"no current XPC connection");
        return;
    }
    NSString *sidecarPath = copyCallerSingBoxPath(conn);
    if (sidecarPath == nil) {
        reply(0, @"failed to derive sing-box path from caller SecCode");
        return;
    }

    __block int resultPid = 0;
    __block NSString *resultErr = nil;
    dispatch_sync(_stateQueue, ^{
        if (self->_activePid != 0) {
            resultErr = [NSString stringWithFormat:
                @"sing-box already running as pid %d", self->_activePid];
            return;
        }

        posix_spawn_file_actions_t actions;
        posix_spawn_file_actions_init(&actions);
        // Don't let sing-box inherit our stdin (launchd daemon's is already
        // /dev/null, but be explicit). Stdout/stderr are inherited so
        // sing-box output lands in the helper's unified log stream.
        posix_spawn_file_actions_addopen(&actions, STDIN_FILENO, "/dev/null", O_RDONLY, 0);

        posix_spawnattr_t attrs;
        posix_spawnattr_init(&attrs);
        short flags = POSIX_SPAWN_SETSIGDEF;
        posix_spawnattr_setflags(&attrs, flags);
        sigset_t defaultSignals;
        sigemptyset(&defaultSignals);
        sigaddset(&defaultSignals, SIGTERM);
        sigaddset(&defaultSignals, SIGHUP);
        sigaddset(&defaultSignals, SIGINT);
        posix_spawnattr_setsigdefault(&attrs, &defaultSignals);

        const char *sidecarC = sidecarPath.UTF8String;
        const char *configC = configPath.UTF8String;
        char *const argv[] = {
            (char *)sidecarC,
            (char *)"run",
            (char *)"-c",
            (char *)configC,
            (char *)"--disable-color",
            NULL
        };

        pid_t pid = 0;
        int rc = posix_spawn(&pid, sidecarC, &actions, &attrs, argv, NULL);
        posix_spawn_file_actions_destroy(&actions);
        posix_spawnattr_destroy(&attrs);

        if (rc != 0) {
            resultErr = [NSString stringWithFormat:@"posix_spawn failed: %s (%d)",
                         strerror(rc), rc];
            return;
        }

        self->_activePid = pid;
        self->_activeConnection = conn;

        // kqueue-based proc exit source. Fires exactly once when the
        // tracked pid terminates; the handler waits the zombie and pushes
        // the exit notification back to the client.
        self->_exitSource = dispatch_source_create(
            DISPATCH_SOURCE_TYPE_PROC,
            (uintptr_t)pid,
            DISPATCH_PROC_EXIT,
            dispatch_get_global_queue(QOS_CLASS_DEFAULT, 0));

        __weak HelperService *weakSelf = self;
        dispatch_source_t source = self->_exitSource;
        dispatch_source_set_event_handler(source, ^{
            HelperService *strongSelf = weakSelf;
            if (!strongSelf) return;

            int status = 0;
            waitpid(pid, &status, WNOHANG);
            int exitCode = -1;
            if (WIFEXITED(status)) {
                exitCode = WEXITSTATUS(status);
            } else if (WIFSIGNALED(status)) {
                exitCode = 128 + WTERMSIG(status);
            }

            NSLog(@"[helper] sing-box pid=%d exited code=%d", pid, exitCode);

            NSXPCConnection *notifyConn = strongSelf->_activeConnection;
            if (notifyConn) {
                id<OneBoxHelperClientProtocol> client =
                    [notifyConn remoteObjectProxyWithErrorHandler:^(NSError *err) {
                        NSLog(@"[helper] failed to notify client of exit: %@", err);
                    }];
                [client singBoxDidExitWithPid:pid exitCode:exitCode];
            }

            dispatch_sync(strongSelf->_stateQueue, ^{
                strongSelf->_activePid = 0;
                strongSelf->_activeConnection = nil;
                if (strongSelf->_exitSource) {
                    dispatch_source_cancel(strongSelf->_exitSource);
                    strongSelf->_exitSource = nil;
                }
            });
        });
        dispatch_resume(source);

        resultPid = pid;
        NSLog(@"[helper] spawned sing-box pid=%d config=%@", pid, configPath);
    });

    reply(resultPid, resultErr);
}

// ------------------------------------------------------------------
// stopSingBox
// ------------------------------------------------------------------
- (void)stopSingBoxWithReply:(void (^)(NSString *))reply {
    __block NSString *err = nil;
    __block pid_t target = 0;
    dispatch_sync(_stateQueue, ^{
        target = self->_activePid;
    });
    if (target == 0) {
        // Not an error — caller may be idempotently stopping.
        reply(nil);
        return;
    }

    if (kill(target, SIGTERM) != 0 && errno != ESRCH) {
        err = [NSString stringWithFormat:@"kill(%d, SIGTERM) failed: %s",
               target, strerror(errno)];
    } else {
        NSLog(@"[helper] sent SIGTERM to sing-box pid=%d", target);
    }
    reply(err);
}

// ------------------------------------------------------------------
// reloadSingBox
// ------------------------------------------------------------------
- (void)reloadSingBoxWithReply:(void (^)(NSString *))reply {
    __block pid_t target = 0;
    dispatch_sync(_stateQueue, ^{
        target = self->_activePid;
    });
    if (target == 0) {
        reply(@"no sing-box process is currently running");
        return;
    }
    if (kill(target, SIGHUP) != 0) {
        reply([NSString stringWithFormat:@"kill(%d, SIGHUP) failed: %s",
               target, strerror(errno)]);
        return;
    }
    NSLog(@"[helper] sent SIGHUP to sing-box pid=%d", target);
    reply(nil);
}

// ------------------------------------------------------------------
// setIpForwarding
// ------------------------------------------------------------------
- (void)setIpForwarding:(BOOL)enable reply:(void (^)(NSString *))reply {
    int value = enable ? 1 : 0;
    int name[] = { CTL_NET, PF_INET, IPPROTO_IP, IPCTL_FORWARDING };
    if (sysctl(name, 4, NULL, NULL, &value, sizeof(value)) != 0) {
        reply([NSString stringWithFormat:@"sysctl ip.forwarding=%d failed: %s",
               value, strerror(errno)]);
        return;
    }
    NSLog(@"[helper] set net.inet.ip.forwarding=%d", value);
    reply(nil);
}

// ------------------------------------------------------------------
// setDnsServers
// ------------------------------------------------------------------
- (void)setDnsServersForService:(NSString *)serviceName
                            spec:(NSString *)dnsSpec
                           reply:(void (^)(NSString *))reply {
    NSString *err = validateServiceName(serviceName);
    if (err) { reply(err); return; }
    err = validateDnsSpec(dnsSpec);
    if (err) { reply(err); return; }

    // Build argv directly; never go through a shell. `setdnsservers` takes
    // either the literal word "empty" or a whitespace-separated list of
    // IPs as trailing args.
    NSMutableArray<NSString *> *args = [NSMutableArray arrayWithObjects:
        @"-setdnsservers", serviceName, nil];
    if ([dnsSpec isEqualToString:@"empty"]) {
        [args addObject:@"empty"];
    } else {
        for (NSString *p in [dnsSpec componentsSeparatedByCharactersInSet:
                             [NSCharacterSet whitespaceCharacterSet]]) {
            if (p.length > 0) [args addObject:p];
        }
    }

    NSString *runErr = runTool(@"/usr/sbin/networksetup", args);
    if (runErr) { reply(runErr); return; }
    NSLog(@"[helper] setdnsservers %@ %@", serviceName, dnsSpec);
    reply(nil);
}

// ------------------------------------------------------------------
// flushDnsCache
// ------------------------------------------------------------------
- (void)flushDnsCacheWithReply:(void (^)(NSString *))reply {
    NSString *err1 = runTool(@"/usr/bin/dscacheutil", @[ @"-flushcache" ]);
    NSString *err2 = runTool(@"/usr/bin/killall", @[ @"-HUP", @"mDNSResponder" ]);
    if (err1 || err2) {
        reply([NSString stringWithFormat:@"flushDnsCache: dscacheutil=%@, killall=%@",
               err1 ?: @"ok", err2 ?: @"ok"]);
        return;
    }
    reply(nil);
}

// ------------------------------------------------------------------
// removeTunRoutes
// ------------------------------------------------------------------
- (void)removeTunRoutesForInterface:(NSString *)interfaceName
                               reply:(void (^)(NSString *))reply {
    NSString *err = validateInterfaceName(interfaceName);
    if (err) { reply(err); return; }

    [self removeRoutesForFamily:@"inet" iface:interfaceName];
    [self removeRoutesForFamily:@"inet6" iface:interfaceName];

    NSString *downErr = runTool(@"/sbin/ifconfig", @[ interfaceName, @"down" ]);
    if (downErr) {
        NSLog(@"[helper] ifconfig %@ down: %@", interfaceName, downErr);
    }
    reply(nil);
}

// Enumerate routes attached to `iface` in the given address family and
// delete each one. Non-fatal on individual delete failures — next hop may
// have already been cleared by the kernel when the interface went down.
- (void)removeRoutesForFamily:(NSString *)family iface:(NSString *)iface {
    NSTask *netstat = [[NSTask alloc] init];
    netstat.launchPath = @"/usr/sbin/netstat";
    netstat.arguments = @[ @"-rn", @"-f", family ];
    NSPipe *outPipe = [NSPipe pipe];
    netstat.standardOutput = outPipe;
    netstat.standardError = [NSFileHandle fileHandleWithNullDevice];
    @try {
        [netstat launch];
    } @catch (NSException *ex) {
        NSLog(@"[helper] netstat launch failed: %@", ex.reason);
        return;
    }
    NSData *stdoutData = [outPipe.fileHandleForReading readDataToEndOfFile];
    [netstat waitUntilExit];

    NSString *text = [[NSString alloc] initWithData:stdoutData encoding:NSUTF8StringEncoding];
    NSArray *lines = [text componentsSeparatedByString:@"\n"];
    // Skip first 4 header lines, then pick rows whose last column == iface.
    NSMutableArray *dests = [NSMutableArray array];
    NSUInteger idx = 0;
    for (NSString *line in lines) {
        idx++;
        if (idx <= 4) continue;
        NSArray *cols = [line componentsSeparatedByCharactersInSet:
                         [NSCharacterSet whitespaceCharacterSet]];
        NSMutableArray *nonEmpty = [NSMutableArray array];
        for (NSString *c in cols) {
            if (c.length > 0) [nonEmpty addObject:c];
        }
        if (nonEmpty.count < 2) continue;
        if ([[nonEmpty lastObject] isEqualToString:iface]) {
            [dests addObject:nonEmpty[0]];
        }
    }

    for (NSString *dest in dests) {
        NSArray *args;
        if ([family isEqualToString:@"inet6"]) {
            args = @[ @"-q", @"delete", @"-inet6", dest ];
        } else {
            args = @[ @"-q", @"delete", dest ];
        }
        NSString *err = runTool(@"/sbin/route", args);
        if (err) {
            NSLog(@"[helper] route delete %@ %@: %@", family, dest, err);
        }
    }
}

@end

// ============================================================================
// Entry point
// ============================================================================

int main(int argc, const char *argv[]) {
    (void)argc;
    (void)argv;
    @autoreleasepool {
        HelperService *delegate = [[HelperService alloc] init];
        NSXPCListener *listener =
            [[NSXPCListener alloc] initWithMachServiceName:@"cloud.oneoh.onebox.helper"];
        listener.delegate = delegate;
        [listener resume];
        [[NSRunLoop currentRunLoop] run];
    }
    return 0;
}

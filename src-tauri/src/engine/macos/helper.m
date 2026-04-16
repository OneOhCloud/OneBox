// Objective-C shim bridging Rust to the OneBox privileged helper over XPC.
//
// Phase 2b.1 introduces a persistent NSXPCConnection + bidirectional XPC so
// the helper can push `singBoxDidExit` events back to the main app without
// polling. The connection is lazily created on first use, cached in a
// singleton, and recreated transparently after invalidation.
//
// Design notes:
// - Every call exposed to Rust blocks the caller on a dispatch semaphore
//   with a hard timeout. Rust wraps them in tokio::task::spawn_blocking so
//   the async runtime stays responsive.
// - All returned C strings are malloc'd and must be freed by the caller via
//   `onebox_helper_free_string`. Passing NULL is safe.
// - Exit notifications from the helper flow through a client-side singleton
//   (`OneBoxHelperClient`) that implements `OneBoxHelperClientProtocol`.
//   The singleton forwards each event to an optional C callback registered
//   from Rust, which in turn bridges into a tokio channel.
// - This file is ARC-enabled (see build.rs -fobjc-arc flag). Do not insert
//   manual retain/release calls.

#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#import <Security/Authorization.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>

static NSString *const kOneBoxHelperMachServiceName = @"cloud.oneoh.onebox.helper";
static const int64_t kOneBoxHelperDefaultTimeoutSeconds = 10;
static const int64_t kOneBoxHelperStartTimeoutSeconds = 30;

// These must exactly match the helper-side protocol signatures — any drift
// between the two sides silently breaks XPC method dispatch.
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

@protocol OneBoxHelperClientProtocol
- (void)singBoxDidExitWithPid:(int)pid exitCode:(int)exitCode;
@end

// ============================================================================
// C callback plumbing for async exit events
// ============================================================================

typedef void (*OneBoxHelperExitCallback)(int pid, int exit_code);
static OneBoxHelperExitCallback g_exitCallback = NULL;

void onebox_helper_set_exit_callback(OneBoxHelperExitCallback cb) {
    g_exitCallback = cb;
}

// ============================================================================
// Persistent connection singleton
// ============================================================================

@interface OneBoxHelperClient : NSObject <OneBoxHelperClientProtocol>
+ (instancetype)sharedClient;
- (NSXPCConnection *)connection;
- (void)invalidate;
@end

@implementation OneBoxHelperClient {
    NSXPCConnection *_connection;
    NSLock *_connectionLock;
}

+ (instancetype)sharedClient {
    static OneBoxHelperClient *instance = nil;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        instance = [[OneBoxHelperClient alloc] init];
    });
    return instance;
}

- (instancetype)init {
    self = [super init];
    if (self) {
        _connectionLock = [[NSLock alloc] init];
    }
    return self;
}

- (NSXPCConnection *)connection {
    [_connectionLock lock];
    if (_connection == nil) {
        NSXPCConnection *conn = [[NSXPCConnection alloc]
            initWithMachServiceName:kOneBoxHelperMachServiceName
                            options:NSXPCConnectionPrivileged];
        conn.remoteObjectInterface =
            [NSXPCInterface interfaceWithProtocol:@protocol(OneBoxHelperProtocol)];
        conn.exportedInterface =
            [NSXPCInterface interfaceWithProtocol:@protocol(OneBoxHelperClientProtocol)];
        conn.exportedObject = self;

        __weak OneBoxHelperClient *weakSelf = self;
        conn.invalidationHandler = ^{
            NSLog(@"[client] XPC connection invalidated");
            OneBoxHelperClient *strongSelf = weakSelf;
            if (strongSelf) {
                [strongSelf->_connectionLock lock];
                strongSelf->_connection = nil;
                [strongSelf->_connectionLock unlock];
            }
        };
        conn.interruptionHandler = ^{
            NSLog(@"[client] XPC connection interrupted");
        };

        [conn resume];
        _connection = conn;
    }
    NSXPCConnection *result = _connection;
    [_connectionLock unlock];
    return result;
}

- (void)invalidate {
    [_connectionLock lock];
    NSXPCConnection *conn = _connection;
    _connection = nil;
    [_connectionLock unlock];
    [conn invalidate];
}

// Helper -> client exit notification. This is the only method the helper
// ever calls on us — everything else is client-initiated. Dispatch to the
// C callback if Rust has registered one.
- (void)singBoxDidExitWithPid:(int)pid exitCode:(int)exitCode {
    NSLog(@"[client] sing-box exit notification pid=%d code=%d", pid, exitCode);
    OneBoxHelperExitCallback cb = g_exitCallback;
    if (cb != NULL) {
        cb(pid, exitCode);
    }
}

@end

// ============================================================================
// Shared utilities
// ============================================================================

static char *onebox_copy_cstring(NSString *s) {
    if (s == nil) {
        return NULL;
    }
    const char *utf8 = [s UTF8String];
    if (utf8 == NULL) {
        return NULL;
    }
    size_t len = strlen(utf8);
    char *out = malloc(len + 1);
    if (out == NULL) {
        return NULL;
    }
    memcpy(out, utf8, len + 1);
    return out;
}

void onebox_helper_free_string(char *s) {
    if (s != NULL) {
        free(s);
    }
}

// Shared template for simple "fire and forget with error reply" methods
// that only return a NSString* error. Returns 0 on success, non-zero on
// failure with *error_out set to an allocated C string.
typedef void (^OneBoxHelperInvokeBlock)(id<OneBoxHelperProtocol> proxy,
                                         void (^replyHandler)(NSString *error));

static int invokeErrorOnly(OneBoxHelperInvokeBlock block,
                           int64_t timeoutSeconds,
                           char **error_out) {
    if (error_out != NULL) {
        *error_out = NULL;
    }

    @autoreleasepool {
        NSXPCConnection *conn = [[OneBoxHelperClient sharedClient] connection];

        __block NSString *errString = nil;
        __block BOOL completed = NO;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        id<OneBoxHelperProtocol> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *err) {
            if (!completed) {
                errString = [NSString stringWithFormat:@"xpc error: %@",
                             err.localizedDescription ?: @"(nil)"];
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        }];

        block(proxy, ^(NSString *replyError) {
            if (!completed) {
                errString = replyError;
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        });

        dispatch_time_t deadline = dispatch_time(
            DISPATCH_TIME_NOW, timeoutSeconds * NSEC_PER_SEC);
        if (dispatch_semaphore_wait(sem, deadline) != 0) {
            if (error_out != NULL) {
                *error_out = onebox_copy_cstring(@"timeout waiting for helper reply");
            }
            return 1;
        }

        if (errString == nil) {
            return 0;
        }
        if (error_out != NULL) {
            *error_out = onebox_copy_cstring(errString);
        }
        return 1;
    }
}

// ============================================================================
// Capability exports
// ============================================================================

int onebox_helper_ping(char **reply_out) {
    if (reply_out != NULL) {
        *reply_out = NULL;
    }

    @autoreleasepool {
        NSXPCConnection *conn = [[OneBoxHelperClient sharedClient] connection];

        __block NSString *successReply = nil;
        __block NSString *errorReply = nil;
        __block BOOL completed = NO;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        id<OneBoxHelperProtocol> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
            if (!completed) {
                errorReply = [NSString stringWithFormat:@"xpc error: %@",
                              error.localizedDescription ?: @"(nil)"];
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        }];

        [proxy pingWithReply:^(NSString *reply) {
            if (!completed) {
                successReply = [reply copy];
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        }];

        dispatch_time_t deadline = dispatch_time(
            DISPATCH_TIME_NOW, kOneBoxHelperDefaultTimeoutSeconds * NSEC_PER_SEC);
        if (dispatch_semaphore_wait(sem, deadline) != 0) {
            if (reply_out != NULL) {
                *reply_out = onebox_copy_cstring(@"timeout waiting for helper reply");
            }
            return 2;
        }

        if (successReply != nil) {
            if (reply_out != NULL) {
                *reply_out = onebox_copy_cstring(successReply);
            }
            return 0;
        }
        if (reply_out != NULL) {
            *reply_out = onebox_copy_cstring(errorReply ?: @"unknown helper error");
        }
        return 1;
    }
}

int onebox_helper_start_sing_box(const char *config_path,
                                  int *pid_out,
                                  char **error_out) {
    if (pid_out != NULL) *pid_out = 0;
    if (error_out != NULL) *error_out = NULL;

    if (config_path == NULL) {
        if (error_out != NULL) {
            *error_out = onebox_copy_cstring(@"config_path is null");
        }
        return 1;
    }

    @autoreleasepool {
        NSString *configPath = [NSString stringWithUTF8String:config_path];
        NSXPCConnection *conn = [[OneBoxHelperClient sharedClient] connection];

        __block int resultPid = 0;
        __block NSString *errString = nil;
        __block BOOL completed = NO;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        id<OneBoxHelperProtocol> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *err) {
            if (!completed) {
                errString = [NSString stringWithFormat:@"xpc error: %@",
                             err.localizedDescription ?: @"(nil)"];
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        }];

        [proxy startSingBoxWithConfigPath:configPath
                                    reply:^(int pid, NSString *error) {
            if (!completed) {
                resultPid = pid;
                errString = error;
                completed = YES;
                dispatch_semaphore_signal(sem);
            }
        }];

        dispatch_time_t deadline = dispatch_time(
            DISPATCH_TIME_NOW, kOneBoxHelperStartTimeoutSeconds * NSEC_PER_SEC);
        if (dispatch_semaphore_wait(sem, deadline) != 0) {
            if (error_out != NULL) {
                *error_out = onebox_copy_cstring(@"timeout waiting for startSingBox reply");
            }
            return 1;
        }

        if (pid_out != NULL) *pid_out = resultPid;

        if (resultPid > 0 && errString == nil) {
            return 0;
        }
        if (error_out != NULL) {
            *error_out = onebox_copy_cstring(errString ?: @"unknown helper error");
        }
        return 1;
    }
}

int onebox_helper_stop_sing_box(char **error_out) {
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy stopSingBoxWithReply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

int onebox_helper_reload_sing_box(char **error_out) {
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy reloadSingBoxWithReply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

int onebox_helper_set_ip_forwarding(bool enable, char **error_out) {
    BOOL objcBool = enable ? YES : NO;
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy setIpForwarding:objcBool reply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

int onebox_helper_set_dns_servers(const char *service_name,
                                   const char *dns_spec,
                                   char **error_out) {
    if (service_name == NULL || dns_spec == NULL) {
        if (error_out != NULL) {
            *error_out = onebox_copy_cstring(@"service_name or dns_spec is null");
        }
        return 1;
    }
    NSString *serviceName = [NSString stringWithUTF8String:service_name];
    NSString *dnsSpec = [NSString stringWithUTF8String:dns_spec];
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy setDnsServersForService:serviceName spec:dnsSpec reply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

int onebox_helper_flush_dns_cache(char **error_out) {
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy flushDnsCacheWithReply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

int onebox_helper_remove_tun_routes(const char *interface_name, char **error_out) {
    if (interface_name == NULL) {
        if (error_out != NULL) {
            *error_out = onebox_copy_cstring(@"interface_name is null");
        }
        return 1;
    }
    NSString *iface = [NSString stringWithUTF8String:interface_name];
    return invokeErrorOnly(^(id<OneBoxHelperProtocol> proxy, void (^replyHandler)(NSString *)) {
        [proxy removeTunRoutesForInterface:iface reply:replyHandler];
    }, kOneBoxHelperDefaultTimeoutSeconds, error_out);
}

// ============================================================================
// SMJobBless install path (unchanged from Phase 1c)
// ============================================================================

// Installs (or upgrades) the privileged helper via SMJobBless. Blocks the
// calling thread while the authorization prompt is on screen — callers should
// invoke this from a background tokio task, not the UI thread.
//
// Returns 0 on success. On any failure, *error_out receives an allocated C
// string describing the error and the return code is non-zero. The caller
// owns *error_out and must free it via onebox_helper_free_string.
//
// SMJobBless is deprecated on macOS 13+ in favor of SMAppService, but it
// still works through Sequoia and remains the only option when supporting
// macOS 10.15–12. The deprecation warning is suppressed locally.
int onebox_helper_install(char **error_out) {
    if (error_out != NULL) {
        *error_out = NULL;
    }

    @autoreleasepool {
        AuthorizationRef authRef = NULL;
        OSStatus status = AuthorizationCreate(
            NULL,
            kAuthorizationEmptyEnvironment,
            kAuthorizationFlagDefaults,
            &authRef);
        if (status != errAuthorizationSuccess || authRef == NULL) {
            if (error_out != NULL) {
                *error_out = onebox_copy_cstring(
                    [NSString stringWithFormat:@"AuthorizationCreate failed: %d", (int)status]);
            }
            return 1;
        }

        AuthorizationItem authItem = {
            kSMRightBlessPrivilegedHelper, 0, NULL, 0
        };
        AuthorizationRights authRights = { 1, &authItem };
        AuthorizationFlags flags =
            kAuthorizationFlagDefaults
            | kAuthorizationFlagInteractionAllowed
            | kAuthorizationFlagPreAuthorize
            | kAuthorizationFlagExtendRights;

        status = AuthorizationCopyRights(
            authRef, &authRights, kAuthorizationEmptyEnvironment, flags, NULL);
        if (status != errAuthorizationSuccess) {
            AuthorizationFree(authRef, kAuthorizationFlagDefaults);
            if (error_out != NULL) {
                NSString *msg;
                if (status == errAuthorizationCanceled) {
                    msg = @"authorization canceled by user";
                } else {
                    msg = [NSString stringWithFormat:@"AuthorizationCopyRights failed: %d", (int)status];
                }
                *error_out = onebox_copy_cstring(msg);
            }
            return 2;
        }

        CFErrorRef cfError = NULL;
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        Boolean ok = SMJobBless(
            kSMDomainSystemLaunchd,
            CFSTR("cloud.oneoh.onebox.helper"),
            authRef,
            &cfError);
#pragma clang diagnostic pop

        AuthorizationFree(authRef, kAuthorizationFlagDestroyRights);

        if (!ok) {
            NSError *err = (__bridge_transfer NSError *)cfError;
            if (error_out != NULL) {
                *error_out = onebox_copy_cstring(
                    [NSString stringWithFormat:@"SMJobBless failed: %@",
                     err.localizedDescription ?: @"(unknown)"]);
            }
            return 3;
        }

        return 0;
    }
}

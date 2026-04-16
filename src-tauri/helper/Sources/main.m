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

#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <bsm/libbsm.h>

// NSXPCConnection has an undocumented but ABI-stable `auditToken` property
// since macOS 10.10. Apple's own EvenBetterAuthorizationSample relies on
// exactly this access pattern; there is no public alternative that returns
// the full audit_token_t needed by SecCodeCopyGuestWithAttributes.
@interface NSXPCConnection (OneBoxPrivate)
@property (nonatomic, readonly) audit_token_t auditToken;
@end

@protocol OneBoxHelperProtocol
- (void)pingWithReply:(void (^)(NSString *reply))reply;
@end

// Must match what gets merged into the main app's Info.plist
// (src-tauri/Info.privileged-helper.plist -> SMPrivilegedExecutables) and
// the signing identity used by scripts/sign-helper.sh. Drift between
// these three places fails closed (reject all connections).
static NSString *const kClientRequirement =
    @"identifier \"cloud.oneoh.onebox\" and anchor apple generic and "
    @"certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and "
    @"certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and "
    @"certificate leaf[subject.OU] = \"GN2W3N34TM\"";

static BOOL validateClient(NSXPCConnection *connection) {
    audit_token_t token = connection.auditToken;

    CFDataRef tokenData = CFDataCreate(NULL, (const UInt8 *)&token, sizeof(token));
    if (tokenData == NULL) {
        NSLog(@"[helper] reject: CFDataCreate failed for audit token");
        return NO;
    }

    const void *keys[] = { kSecGuestAttributeAudit };
    const void *values[] = { tokenData };
    CFDictionaryRef attrs = CFDictionaryCreate(
        NULL,
        keys,
        values,
        1,
        &kCFTypeDictionaryKeyCallBacks,
        &kCFTypeDictionaryValueCallBacks);
    CFRelease(tokenData);
    if (attrs == NULL) {
        NSLog(@"[helper] reject: CFDictionaryCreate failed");
        return NO;
    }

    SecCodeRef code = NULL;
    OSStatus status = SecCodeCopyGuestWithAttributes(NULL, attrs, kSecCSDefaultFlags, &code);
    CFRelease(attrs);
    if (status != errSecSuccess || code == NULL) {
        NSLog(@"[helper] reject: SecCodeCopyGuestWithAttributes failed: %d", (int)status);
        if (code) CFRelease(code);
        return NO;
    }

    SecRequirementRef requirement = NULL;
    status = SecRequirementCreateWithString(
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

@interface HelperService : NSObject <NSXPCListenerDelegate, OneBoxHelperProtocol>
@end

@implementation HelperService

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
    [newConnection resume];
    return YES;
}

- (void)pingWithReply:(void (^)(NSString *))reply {
    reply([NSString stringWithFormat:@"pong pid=%d uid=%d", getpid(), getuid()]);
}

@end

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

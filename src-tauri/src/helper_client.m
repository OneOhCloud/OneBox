// Objective-C shim bridging Rust to the OneBox privileged helper over XPC.
//
// Phase 1b: only `ping` is implemented. SMJobBless install and the real
// privileged methods come in later phases.
//
// Design notes:
// - Synchronous Rust FFI is easier to reason about than async callbacks
//   bubbling up through Tauri commands, so each function blocks the calling
//   thread on a dispatch semaphore with a hard timeout.
// - All returned C strings are malloc'd and must be freed by the caller via
//   `onebox_helper_free_string`. Passing NULL is safe.
// - This file is ARC-enabled (see build.rs -fobjc-arc flag). Do not insert
//   manual retain/release calls.

#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#import <Security/Authorization.h>
#include <stdlib.h>
#include <string.h>

static NSString *const kOneBoxHelperMachServiceName = @"cloud.oneoh.onebox.helper";
static const int64_t kOneBoxHelperTimeoutSeconds = 5;

// Must match the @objc protocol exposed by the helper binary
// (src-tauri/helper/Sources/main.swift). The Objective-C selector name is
// `pingWithReply:` which corresponds to Swift's
// `ping(withReply:)` thanks to the `@objc` attribute.
@protocol OneBoxHelperProtocol
- (void)pingWithReply:(void (^)(NSString *reply))reply;
@end

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

// Returns 0 on success, non-zero on failure.
// On success, *reply_out receives the helper's reply string.
// On failure, *reply_out receives a human-readable error string.
// In either case the caller owns *reply_out and must free it via
// onebox_helper_free_string. *reply_out may be NULL on allocation failure.
int onebox_helper_ping(char **reply_out) {
    if (reply_out != NULL) {
        *reply_out = NULL;
    }

    @autoreleasepool {
        NSXPCConnection *conn = [[NSXPCConnection alloc]
            initWithMachServiceName:kOneBoxHelperMachServiceName
                            options:NSXPCConnectionPrivileged];
        conn.remoteObjectInterface =
            [NSXPCInterface interfaceWithProtocol:@protocol(OneBoxHelperProtocol)];
        [conn resume];

        __block NSString *successReply = nil;
        __block NSString *errorReply = nil;
        dispatch_semaphore_t sem = dispatch_semaphore_create(0);

        // Two exit paths fire the semaphore:
        //   1. remoteObjectProxyWithErrorHandler's error block (connection
        //      invalid, helper not installed, signature mismatch, etc.)
        //   2. pingWithReply's reply block (success)
        id<OneBoxHelperProtocol> proxy = [conn remoteObjectProxyWithErrorHandler:^(NSError *error) {
            if (successReply == nil && errorReply == nil) {
                errorReply = [NSString stringWithFormat:@"xpc error: %@",
                              error.localizedDescription ?: @"(nil)"];
            }
            dispatch_semaphore_signal(sem);
        }];

        [proxy pingWithReply:^(NSString *reply) {
            if (successReply == nil && errorReply == nil) {
                successReply = [reply copy];
            }
            dispatch_semaphore_signal(sem);
        }];

        dispatch_time_t deadline = dispatch_time(
            DISPATCH_TIME_NOW, kOneBoxHelperTimeoutSeconds * NSEC_PER_SEC);
        long waitResult = dispatch_semaphore_wait(sem, deadline);
        [conn invalidate];

        if (waitResult != 0) {
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

void onebox_helper_free_string(char *s) {
    if (s != NULL) {
        free(s);
    }
}

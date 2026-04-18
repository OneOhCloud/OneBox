#import <Cocoa/Cocoa.h>

// Force NSWindow.appearance on the main thread. tao/Tauri 2.10 on macOS 26
// was observed to no-op the equivalent setTheme() call — the JS promise
// resolves, no error is thrown, but the NSWindow appearance never flips.
// Possible causes: internal call off main thread, or the runtime overwrites
// our set on the next run-loop tick. This shim dispatches explicitly to
// the main queue so AppKit applies the change synchronously with its own
// drawing cycle.
//
// theme values:
//   0 → nil      → inherit from NSApp (follows OS prefers-color-scheme)
//   1 → Aqua     → force light
//   2 → DarkAqua → force dark
void onebox_set_window_appearance(void* ns_window_ptr, int theme) {
    if (ns_window_ptr == NULL) {
        return;
    }
    NSWindow* window = (__bridge NSWindow*)ns_window_ptr;

    NSAppearance* appearance = nil;
    if (theme == 1) {
        appearance = [NSAppearance appearanceNamed:NSAppearanceNameAqua];
    } else if (theme == 2) {
        appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        window.appearance = appearance;
        // Nudge AppKit to repaint title bar + controls immediately rather
        // than waiting for the next event.
        [window displayIfNeeded];
    });
}

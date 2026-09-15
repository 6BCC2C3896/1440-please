# Compatibility

## Supported

- Firefox desktop
- Manifest V3
- Firefox 142+ as declared by the current manifest

## Developed/tested against

The extension has been developed around Firefox desktop behavior and manually exercised in Firefox Developer Edition. Automated tests run under Node and simulate/execute the pure controller and MAIN-world bridge contracts, but they do not replace live YouTube testing.

## Not supported/tested

- Chrome / Chromium
- Microsoft Edge
- Safari
- Firefox for Android
- embedded YouTube players outside the normal `youtube.com` watch experience

## Why Firefox-only

The implementation depends on Firefox WebExtension behavior, isolated/Main world coordination, Firefox request telemetry, and the current internal YouTube page-player surface. Supporting another browser should be treated as a separate port with its own live validation, not as a manifest-copy exercise.

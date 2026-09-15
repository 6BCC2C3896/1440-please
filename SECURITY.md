# Security Policy

## Supported versions

Security fixes are expected to target the latest release of **1440, Please**.

## Reporting a vulnerability

Please do **not** publish a security-sensitive issue with exploit details before maintainers have had a reasonable chance to review it.

If the GitHub repository has private vulnerability reporting enabled, use **Security → Report a vulnerability**. Otherwise, open a minimal issue requesting a private contact channel without including sensitive reproduction details.

Useful reports include:

- affected extension version;
- Firefox version;
- impact;
- minimal reproduction steps;
- whether the issue requires a malicious web page, extension, or local access.

## Security boundaries

The project intentionally avoids invasive media-control techniques such as page fetch/XHR monkeypatching, SABR payload rewriting, and synthetic parallel media downloads. `tools/forbidden-capability-scan.js` enforces those boundaries in CI.

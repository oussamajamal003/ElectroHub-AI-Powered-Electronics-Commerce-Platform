# Logging, OpenAPI and email validation — work in progress

Baseline: `feature/06.2-accessibility-qa-ci-cd` at `9e506557b3f84049e4c1fdf27d2abe39e1055159`.

This is not completion evidence. A preliminary in-memory traversal in test mode found 219 distinct operations in the API router, of which 150 lacked a corresponding method/path in the generated specification. This is not a definitive coverage count: it excludes the test-only `/__e2e` routes and does not include top-level mounts such as the webhook or documentation endpoints. The full endpoint inventory, accurate OpenAPI coverage and route-to-spec guard remain outstanding, as do full regression and browser verification. Do not treat the existing specification as complete.

Customer authentication schemas trim surrounding email whitespace before Zod validation. Editable customer and administrator forms use a shared Zod-backed email check, including targeted missing-local-part and missing-domain messages. Administrator invitation and activation pages also show read-only addresses. No database migration is included.

The existing Winston transport retains responsibility for file output, rotation and sanitization. Backend records now carry service and environment fields. Swagger annotation discovery is relative to the source or compiled module instead of the process working directory; complete API documentation remains outstanding.

In a disposable dependency copy, the logging suite passed 48 tests, including file-output and redaction tests; customer schema tests passed 9 tests; three targeted frontend suites passed 53 tests; and Swagger UI/JSON smoke tests passed 4 tests. Frontend and backend typechecks and lint passed (frontend lint reported three existing Fast Refresh warnings). These results do not establish complete error capture, endpoint coverage, browser behavior, or production operation.

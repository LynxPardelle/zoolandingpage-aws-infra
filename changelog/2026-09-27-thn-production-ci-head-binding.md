# Production promotion checkout identity

- Compare the native merge commit read from `HEAD` with `GITHUB_SHA` before
  checking either parent or the exact source-only promotion selector.
- Reproduce the unused-commit `SC2034` warning with CI's actionlint 1.7.12
  and official ShellCheck 0.9.0, then pass the same enabled check after binding
  the checkout identity. This change does not activate AWS.

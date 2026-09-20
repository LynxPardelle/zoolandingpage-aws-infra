# THN TEST postmortem source ancestry

The detailed read-only diagnosis was promoted to TEST, but the workflow's
source guard accepted only its immediate TEST parent. That excludes the
original failed `apply` after subsequent read-only promotions. No diagnostic
was dispatched with a false source SHA.

The guard now accepts only one of the five recent first-parent TEST commits
before the reviewed promotion. All other exact-source, digest, branch, and
tree checks remain in place. This changes no AWS permission or resource.

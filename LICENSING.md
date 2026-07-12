# Postgram licensing

This repository contains components with different licenses. The license for a
file is determined by the most specific path rule below.

| Path                                                      | License                                          |
| --------------------------------------------------------- | ------------------------------------------------ |
| `cli/**`                                                  | MIT                                              |
| `skill/**`                                                | MIT                                              |
| `templates/**`                                            | MIT                                              |
| `packages/browser-extension-chrome/**`                    | MIT                                              |
| `packages/browser-extension-firefox/**`                   | MIT                                              |
| `docs/**` documentation prose                             | CC BY 4.0                                        |
| `README.md` documentation prose                           | CC BY 4.0                                        |
| Postgram names, logos, icons, and other brand identifiers | No trademark rights granted; see `TRADEMARKS.md` |
| All other original Postgram source and repository content | AGPL-3.0-only                                    |

Third-party dependencies and vendored material remain under their respective
licenses. A license notice next to a specific file takes precedence over this
repository-level summary.

The trademark rule is independent of these copyright licenses: a license may
permit copying an asset without granting the right to use it as a product or
service mark.

## Service license

The Postgram server, the `pgm-admin` operator CLI, and the browser UI are
licensed under the GNU Affero General Public License version 3 only. This is an
OSI-approved open-source license and permits commercial use, modification, and
redistribution subject to its terms.

If you run a modified version that supports remote network interaction,
AGPLv3 section 13 requires that version to prominently offer its corresponding
source to users interacting with it remotely. Read the complete terms in
[`LICENSE`](LICENSE).

The AGPL does not license the Postgram trademarks and does not prevent charging
for hosting, support, consulting, or distribution.

## Client licenses

The `pgm` CLI, portable agent skills and templates, and browser extensions are
independent clients and integrations licensed under the MIT License. They may
be used to connect to an AGPL-licensed Postgram service or to another compatible
service without imposing the AGPL on that separate client or service merely
because they communicate over documented interfaces.

Each client directory contains its own `LICENSE` file.

## Documentation license

Documentation prose in `docs/` and `README.md` is licensed under Creative
Commons Attribution 4.0 International. Attribution should identify "Postgram"
and link to <https://github.com/ivo-toby/postgram> when reasonably practical.

Source code and executable examples embedded in documentation are licensed
under the license that applies to the component they demonstrate, rather than
CC BY 4.0. Brand assets remain subject to the trademark policy.

## Commercial licensing

The project owner may offer separate commercial licenses for Postgram. A
commercial license is not required to run, modify, or sell AGPL-compliant
versions. It may be useful when an organization wants different terms.

Questions about a commercial license or trademark permission can be opened as
a private security advisory or directed to the repository owner through the
contact methods on their GitHub profile.

This document is a practical summary, not a replacement for the license texts
and not legal advice. If this summary conflicts with an applicable license, the
license controls.

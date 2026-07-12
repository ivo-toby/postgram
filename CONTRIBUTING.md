# Contributing to Postgram

Thank you for helping improve Postgram.

## Before opening a pull request

1. Open an issue or discussion for substantial behavioral, architectural, or
   licensing changes before investing in an implementation.
2. Keep changes focused and follow the repository guidance in `AGENTS.md`.
3. Add focused tests when behavior changes.
4. Run the relevant validation:

   ```bash
   npm run typecheck
   npm test
   npm run build
   npm --prefix ui run typecheck
   npm --prefix ui test
   npm --prefix ui run build
   ```

5. Explain the change, impact, and verification in the pull request.

## Contributor License Agreement

Postgram may be offered under both its public open-source licenses and separate
commercial terms. To keep that option available, every contributor must accept
the [Postgram Contributor License Agreement](CONTRIBUTOR_LICENSE_AGREEMENT.md)
before their contribution can be merged.

After reading the agreement, add the following exact statement to your pull
request description or as a pull request comment:

> I have read and agree to the Postgram Contributor License Agreement v1.0.

If you contribute on behalf of an employer or other organization, you must have
authority to grant the rights in the agreement. A maintainer may request
separate entity authorization for substantial organizational contributions.

## License of contributions

Accepted contributions are distributed under the license applicable to their
repository path as described in [`LICENSING.md`](LICENSING.md). The contributor
agreement is an additional inbound grant to the project owner; it does not
change the public license users receive for the contribution.

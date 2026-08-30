# Contributing to the MapOS region pipeline

Thanks for considering a contribution. We appreciate your efforts to make MapOS better.

## Reporting issues

If you hit a bug, open a GitHub issue. Check the existing issues first to avoid
duplicates. Include a clear description of the problem, the command you ran
(region slug or `SRC_URL` if relevant), what you expected instead, and the
error text. Node version and whether Docker Desktop was running help too.

## Feature requests

Open a GitHub issue and describe what you're trying to do, not only the feature
you have in mind. If you're planning something substantial, wait for a
maintainer to agree on the approach before starting.

## Submitting changes

Node 22 and pnpm; see [README.md](README.md) for local setup.

To contribute code changes:

1. Fork the repository and create a branch off `main`.
2. Make sure your code follows the project's coding conventions.
3. Run `pnpm check` and `pnpm typecheck`.
4. Make commits with clear, descriptive messages. Each commit should have a single
   logical purpose.
5. Push your branch to your fork and open a pull request against `main`.
6. Describe what changed and why, and link any related issue.

A maintainer will review your PR, give feedback if needed, and merge it once it
meets the project's standards. Small, focused pull requests get reviewed faster.

## Coding conventions

Please match the existing conventions and style of the file you're editing.
Formatting is Biome-enforced — run `pnpm check` rather than hand-formatting.

If you're unsure about any aspect of the conventions, feel free to ask in your PR.

## Documentation

Improvements to documentation are always welcome and don't need an issue first.
If something in the README was wrong or confusing while you were getting set up,
fixing it is a genuinely useful contribution.

## Licensing of contributions

This repo is [Apache-2.0](LICENSE). By submitting a pull request you agree that
your contribution is licensed under those same terms.

## Questions

[hello@mapos.md](mailto:hello@mapos.md)

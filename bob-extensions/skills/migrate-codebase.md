# Code Migration Skill

This skill helps Bob understand how to orchestrate code migrations.

## Migration Playbook

1. **Read changelog first** - Always fetch upstream breaking changes
2. **Find scope** - Identify all affected files via imports/usage
3. **Patch leaves before roots** - Migrate dependencies before dependents
4. **Generate tests** - Lock in new behavior with regression tests
5. **Run sandbox** - Execute in isolated environment
6. **Sign audit** - Cryptographically sign the results

## When to use this skill

- User mentions "migrate", "upgrade", "update version"
- User provides a target version (e.g., "React 19")
- User asks about breaking changes

## Tools to use

- `plan_migration` - Get breaking-change map
- `find_affected_files` - Structural + semantic retrieval
- `propose_patch` - Generate migration patches
- `generate_test_for` - Create regression tests
- `sign_audit` - Produce signed report
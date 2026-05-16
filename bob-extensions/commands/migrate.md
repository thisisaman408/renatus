# /migrate Command

Initiates a code migration using the Renatus migration crew.

## Usage

```
/migrate <target-version>
```

## Examples

```
/migrate react-19
/migrate python-3.12
/migrate tailwind-4
```

## What it does

1. Switches to Migration mode
2. Calls the `migrate_repository` MCP tool
3. Streams progress via SSE
4. Returns audit URL when complete

## Implementation

When this command is invoked:
1. Switch to Migration mode
2. Call `mcp:renatus:ping` to verify connectivity
3. (Full implementation in Wave 2)
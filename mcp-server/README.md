# RogueElements MCP Server

MCP (Model Context Protocol) server for working with the RogueElements procedural map generation library.

## Features

### Resources

Access documentation directly from MCP clients:

| Resource | URI | Description |
|----------|-----|-------------|
| Architecture | `rogue://docs/architecture` | Interface hierarchy, GenStep categories, data flow |
| Flows | `rogue://docs/flows` | Traced code paths for key operations |
| Patterns | `rogue://docs/patterns` | Step-by-step recipes for common tasks |

### Prompts

Pre-built prompts for common development tasks:

| Prompt | Description |
|--------|-------------|
| `create_roomgen` | Guide for creating a custom RoomGen |
| `create_genstep` | Guide for creating a custom GenStep |
| `create_spawnable` | Guide for creating a custom spawnable type |
| `create_context` | Guide for creating a custom map context |

### Tools

Code generation tools:

| Tool | Description |
|------|-------------|
| `rogue_scaffold_roomgen` | Generate boilerplate for a custom RoomGen |
| `rogue_scaffold_genstep` | Generate boilerplate for a custom GenStep |
| `rogue_list_interfaces` | List context interfaces with capabilities |

## Installation

```bash
cd mcp-server
npm install
npm run build
```

## Usage

### With Claude Code

Add to your Claude Code MCP settings (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "rogueelemens": {
      "command": "node",
      "args": ["/path/to/RogueElements/mcp-server/dist/index.js"]
    }
  }
}
```

### Development

```bash
# Watch mode with auto-reload
npm run dev

# Build for production
npm run build

# Run the server
npm start
```

## Example Tool Usage

### Scaffold a RoomGen

```
Tool: rogue_scaffold_roomgen
Args: { "name": "Diamond", "shape_description": "diamond-shaped" }
```

Generates:

```csharp
[Serializable]
public class RoomGenDiamond<T> : RoomGen<T>
    where T : ITiledGenContext
{
    public override RoomGen<T> Copy() => new RoomGenDiamond<T>();

    public override Loc ProposeSize(IRandom rand) { ... }

    public override void DrawOnMap(T map) { ... }
}
```

### Scaffold a GenStep

```
Tool: rogue_scaffold_genstep
Args: {
  "name": "AddPillars",
  "context_type": "ITiledGenContext",
  "description": "Adds decorative pillars to rooms"
}
```

## Requirements

- Node.js >= 18
- Built from RogueElements repository root (needs `docs/claude/` directory)

#!/usr/bin/env node
/**
 * MCP Server for RogueElements
 *
 * Provides documentation resources, prompts, and code generation tools
 * for working with the RogueElements procedural map generation library.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Find the docs directory relative to this server
const findDocsDir = (): string => {
  // Try relative to compiled dist/
  let docsDir = path.resolve(__dirname, "../../docs/claude");
  if (fs.existsSync(docsDir)) return docsDir;

  // Try relative to src/
  docsDir = path.resolve(__dirname, "../docs/claude");
  if (fs.existsSync(docsDir)) return docsDir;

  // Try from project root
  docsDir = path.resolve(process.cwd(), "docs/claude");
  if (fs.existsSync(docsDir)) return docsDir;

  throw new Error("Could not find docs/claude directory");
};

const DOCS_DIR = findDocsDir();

// Create MCP server
const server = new McpServer({
  name: "rogueelemens-mcp-server",
  version: "1.0.0"
});

// =============================================================================
// RESOURCES - Expose documentation files
// =============================================================================

const docFiles = ["architecture", "flows", "patterns"] as const;

// Register each documentation resource
for (const docName of docFiles) {
  server.resource(
    `rogue-docs-${docName}`,
    `rogue://docs/${docName}`,
    async () => {
      const filePath = path.join(DOCS_DIR, `${docName}.md`);
      const content = fs.readFileSync(filePath, "utf-8");
      return {
        contents: [{
          uri: `rogue://docs/${docName}`,
          mimeType: "text/markdown",
          text: content
        }]
      };
    }
  );
}

// =============================================================================
// PROMPTS - Pre-built prompts for common tasks
// =============================================================================

server.prompt(
  "create_roomgen",
  "Guide for creating a custom RoomGen in RogueElements",
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Help me create a custom RoomGen for RogueElements.

A RoomGen defines the shape of a room. Here's what I need to implement:

1. Inherit from \`RoomGen<T>\` or \`PermissiveRoomGen<T>\` where T : ITiledGenContext
2. Override \`PrepareSize(IRandom rand, bool restrictToRectilinear)\` to set room dimensions
3. Override \`DrawOnMap(T map)\` to render the room shape to tiles
4. Implement \`Copy()\` for cloning

Example structure:
\`\`\`csharp
[Serializable]
public class RoomGenCustom<T> : RoomGen<T>
    where T : ITiledGenContext
{
    public override RoomGen<T> Copy() => new RoomGenCustom<T>();

    public override Loc ProposeSize(IRandom rand)
    {
        return new Loc(/* width */, /* height */);
    }

    public override void DrawOnMap(T map)
    {
        // Use this.Draw to get the room bounds
        // Use map.SetTile() to place floor tiles
        for (int x = this.Draw.X; x < this.Draw.End.X; x++)
            for (int y = this.Draw.Y; y < this.Draw.End.Y; y++)
                map.SetTile(new Loc(x, y), map.RoomTerrain.Copy());
    }
}
\`\`\`

What shape of room would you like to create?`
      }
    }]
  })
);

server.prompt(
  "create_genstep",
  "Guide for creating a custom GenStep in RogueElements",
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Help me create a custom GenStep for RogueElements.

A GenStep is a single step in the map generation pipeline. Here's what I need to implement:

1. Inherit from \`GenStep<T>\` where T constrains to required context interfaces
2. Add \`[Serializable]\` attribute for save/load support
3. Override \`Apply(T map)\` with generation logic
4. Add to pipeline with \`layout.GenSteps.Add(new Priority(N), step)\`

Common context interfaces:
- \`ITiledGenContext\` - Basic tile operations
- \`IFloorPlanGenContext\` - Room-based layouts
- \`IRoomGridGenContext\` - Grid-based layouts
- \`IPlaceableGenContext<T>\` - Entity spawning

Example structure:
\`\`\`csharp
[Serializable]
public class MyCustomStep<T> : GenStep<T>
    where T : class, ITiledGenContext
{
    public override void Apply(T map)
    {
        // Use map.Rand for random numbers
        // Use map.SetTile() to modify tiles
        // Use map.Width/Height for dimensions
    }
}
\`\`\`

What kind of generation step would you like to create?`
      }
    }]
  })
);

server.prompt(
  "create_spawnable",
  "Guide for creating a custom spawnable type in RogueElements",
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Help me create a custom spawnable type for RogueElements.

A spawnable is any entity that can be placed on the map (items, enemies, traps, etc.).

Steps:
1. Create a class implementing \`ISpawnable\` (just needs \`Copy()\` method)
2. Add \`IPlaceableGenContext<YourType>\` to your map context
3. Use spawn steps like \`RandomSpawnStep\` to place them

Example spawnable:
\`\`\`csharp
[Serializable]
public class Trap : ISpawnable
{
    public string Name { get; set; }
    public int Damage { get; set; }

    public Trap() { }

    public ISpawnable Copy() => new Trap
    {
        Name = this.Name,
        Damage = this.Damage
    };
}
\`\`\`

Context implementation:
\`\`\`csharp
public class MyContext : ITiledGenContext, IPlaceableGenContext<Trap>
{
    public List<Trap> Traps { get; } = new();

    public List<Loc> GetAllFreeTiles() => /* find walkable tiles */;
    public List<Loc> GetFreeTiles(Rect rect) => /* find in area */;
    public bool CanPlaceItem(Loc loc) => /* check if valid */;
    public void PlaceItem(Loc loc, Trap item) => Traps.Add(item.Copy());
}
\`\`\`

What kind of entity would you like to spawn?`
      }
    }]
  })
);

server.prompt(
  "create_context",
  "Guide for creating a custom map context in RogueElements",
  () => ({
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `Help me create a custom map context for RogueElements.

The map context holds all state during generation. Implement interfaces based on what GenSteps you need:

Interface hierarchy:
\`\`\`
IGenContext (base - Rand, InitSeed, FinishGen)
├── ITiledGenContext (tiles - Width, Height, SetTile, GetTile)
│   └── IFloorPlanGenContext (rooms - RoomPlan, InitPlan)
│       └── IRoomGridGenContext (grid - GridPlan, InitGrid)
└── IPlaceableGenContext<T> (spawning - PlaceItem, GetFreeTiles)
\`\`\`

Minimal example (tiles only):
\`\`\`csharp
public class MyContext : ITiledGenContext
{
    private ReRandom rand;
    private ITile[][] tiles;

    public IRandom Rand => rand;
    public int Width => tiles?.Length ?? 0;
    public int Height => tiles?[0]?.Length ?? 0;
    public ITile RoomTerrain => new Tile(1);
    public ITile WallTerrain => new Tile(0);
    public bool TilesInitialized => tiles != null;
    public bool Wrap => false;

    public void InitSeed(ulong seed) => rand = new ReRandom(seed);
    public void FinishGen() { }

    public void CreateNew(int width, int height, bool wrap = false)
    {
        tiles = new ITile[width][];
        for (int i = 0; i < width; i++)
            tiles[i] = new ITile[height];
    }

    // Implement remaining interface methods...
}
\`\`\`

What capabilities does your context need?`
      }
    }]
  })
);

// =============================================================================
// TOOLS - Code generation
// =============================================================================

// Tool: Scaffold a RoomGen
server.tool(
  "rogue_scaffold_roomgen",
  "Generate boilerplate code for a custom RogueElements RoomGen",
  {
    name: z.string()
      .min(1, "Name is required")
      .describe("Name for the RoomGen class (e.g., 'Diamond', 'Cross')"),
    shape_description: z.string()
      .describe("Description of the room shape to generate")
  },
  async ({ name, shape_description }) => {
    const className = `RoomGen${name}`;
    const code = `using System;
using RogueElements;

namespace YourNamespace
{
    /// <summary>
    /// Generates ${shape_description.toLowerCase()} shaped rooms.
    /// </summary>
    [Serializable]
    public class ${className}<T> : RoomGen<T>
        where T : ITiledGenContext
    {
        /// <summary>
        /// Creates a copy of this room generator.
        /// </summary>
        public override RoomGen<T> Copy() => new ${className}<T>();

        /// <summary>
        /// Proposes the size of the room.
        /// </summary>
        /// <param name="rand">Random number generator.</param>
        /// <returns>The proposed room dimensions.</returns>
        public override Loc ProposeSize(IRandom rand)
        {
            // TODO: Return appropriate dimensions for ${shape_description}
            int width = rand.Next(5, 10);
            int height = rand.Next(5, 10);
            return new Loc(width, height);
        }

        /// <summary>
        /// Draws the room shape onto the map.
        /// </summary>
        /// <param name="map">The map context to draw on.</param>
        public override void DrawOnMap(T map)
        {
            // TODO: Implement ${shape_description} shape
            // this.Draw contains the room bounds (X, Y, Width, Height, End)
            // Use map.SetTile(loc, map.RoomTerrain.Copy()) to place floor tiles

            for (int x = this.Draw.X; x < this.Draw.End.X; x++)
            {
                for (int y = this.Draw.Y; y < this.Draw.End.Y; y++)
                {
                    Loc loc = new Loc(x, y);
                    // TODO: Add shape logic here
                    // if (IsInsideShape(x, y))
                    map.SetTile(loc, map.RoomTerrain.Copy());
                }
            }
        }
    }
}`;

    return {
      content: [{
        type: "text",
        text: `Generated RoomGen scaffold for "${name}":\n\n\`\`\`csharp\n${code}\n\`\`\`\n\nNext steps:\n1. Implement ProposeSize() to return appropriate dimensions\n2. Implement DrawOnMap() with your shape logic\n3. Register in your pipeline: \`roomGen.Add(new ${className}<T>(), weight)\``
      }]
    };
  }
);

// Tool: Scaffold a GenStep
server.tool(
  "rogue_scaffold_genstep",
  "Generate boilerplate code for a custom RogueElements GenStep",
  {
    name: z.string()
      .min(1, "Name is required")
      .describe("Name for the GenStep class (e.g., 'AddPillars', 'ScatterItems')"),
    context_type: z.enum(["ITiledGenContext", "IFloorPlanGenContext", "IRoomGridGenContext"])
      .describe("The context interface this step requires"),
    description: z.string()
      .describe("What this generation step does")
  },
  async ({ name, context_type, description }) => {
    const className = `${name}Step`;
    const code = `using System;
using RogueElements;

namespace YourNamespace
{
    /// <summary>
    /// ${description}
    /// </summary>
    [Serializable]
    public class ${className}<T> : GenStep<T>
        where T : class, ${context_type}
    {
        /// <summary>
        /// Applies this generation step to the map.
        /// </summary>
        /// <param name="map">The map context to modify.</param>
        public override void Apply(T map)
        {
            // TODO: Implement ${description.toLowerCase()}

            // Available from ITiledGenContext:
            // - map.Rand: Seeded random number generator
            // - map.Width, map.Height: Map dimensions
            // - map.SetTile(loc, tile): Place a tile
            // - map.GetTile(loc): Get tile at location
            // - map.RoomTerrain, map.WallTerrain: Terrain templates
            ${context_type === "IFloorPlanGenContext" || context_type === "IRoomGridGenContext" ? `
            // Available from IFloorPlanGenContext:
            // - map.RoomPlan: The floor plan with rooms and halls
            // - map.RoomPlan.RoomCount: Number of rooms
            // - map.RoomPlan.GetRoom(index): Get room by index` : ""}
            ${context_type === "IRoomGridGenContext" ? `
            // Available from IRoomGridGenContext:
            // - map.GridPlan: The grid plan
            // - map.GridPlan.GridWidth, GridHeight: Grid dimensions
            // - map.GridPlan.GetRoomPlan(x, y): Get room at grid cell` : ""}

            // Example: iterate over tiles
            for (int x = 0; x < map.Width; x++)
            {
                for (int y = 0; y < map.Height; y++)
                {
                    Loc loc = new Loc(x, y);
                    // TODO: Add your logic here
                }
            }
        }
    }
}`;

    return {
      content: [{
        type: "text",
        text: `Generated GenStep scaffold for "${name}":\n\n\`\`\`csharp\n${code}\n\`\`\`\n\nNext steps:\n1. Implement Apply() with your generation logic\n2. Add to pipeline: \`layout.GenSteps.Add(new Priority(N), new ${className}<T>())\`\n3. Choose priority based on when this should run (lower = earlier)`
      }]
    };
  }
);

// Tool: List interfaces
server.tool(
  "rogue_list_interfaces",
  "List RogueElements context interfaces with their capabilities",
  {},
  async () => {
    const interfaces = `# RogueElements Context Interfaces

## Interface Hierarchy

\`\`\`
IGenContext (base)
├── ITiledGenContext
│   └── IFloorPlanGenContext
│       └── IRoomGridGenContext
├── IPlaceableGenContext<T>
│   └── IViewPlaceableGenContext<T>
│       └── IReplaceableGenContext<T>
└── ISpawningGenContext<T>
\`\`\`

## Interface Details

### IGenContext
Base interface for all contexts.
- \`IRandom Rand\` - Seeded random number generator
- \`void InitSeed(ulong seed)\` - Initialize with seed
- \`void FinishGen()\` - Called after generation completes

### ITiledGenContext : IGenContext
Tile-based map operations.
- \`int Width, Height\` - Map dimensions
- \`ITile RoomTerrain, WallTerrain\` - Terrain templates
- \`bool TilesInitialized\` - Whether tiles are ready
- \`void SetTile(Loc, ITile)\` - Place a tile
- \`ITile GetTile(Loc)\` - Get tile at location
- \`bool TileBlocked(Loc)\` - Check if blocked
- \`void CreateNew(width, height)\` - Create tile array

### IFloorPlanGenContext : ITiledGenContext
Room-based layouts using FloorPlan.
- \`FloorPlan RoomPlan\` - The floor plan
- \`void InitPlan(FloorPlan)\` - Initialize with plan

### IRoomGridGenContext : IFloorPlanGenContext
Grid-based layouts using GridPlan.
- \`GridPlan GridPlan\` - The grid plan
- \`void InitGrid(GridPlan)\` - Initialize with plan

### IPlaceableGenContext<T> : IGenContext
Entity spawning for type T.
- \`List<Loc> GetAllFreeTiles()\` - Find spawn locations
- \`List<Loc> GetFreeTiles(Rect)\` - Find in area
- \`bool CanPlaceItem(Loc)\` - Check if valid
- \`void PlaceItem(Loc, T)\` - Place entity

### IViewPlaceableGenContext<T> : IPlaceableGenContext<T>
Adds ability to query placed items.
- \`int Count\` - Number of placed items
- \`T GetItem(int index)\` - Get item by index
- \`Loc GetLoc(int index)\` - Get location by index

### IReplaceableGenContext<T> : IViewPlaceableGenContext<T>
Adds ability to remove items.
- \`void RemoveItemAt(int index)\` - Remove item

### ISpawningGenContext<T> : IGenContext
Weighted spawn lists.
- \`SpawnList<T> Spawns\` - Spawn table
`;

    return {
      content: [{
        type: "text",
        text: interfaces
      }]
    };
  }
);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RogueElements MCP server running via stdio");
}

main().catch(error => {
  console.error("Server error:", error);
  process.exit(1);
});

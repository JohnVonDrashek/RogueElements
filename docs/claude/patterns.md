# RogueElements Patterns

Step-by-step recipes for common modifications to RogueElements.

## 1. Add a Custom RoomGen

Room generators define shapes that can be placed in floor plans. All rooms must be traversable (any entry can reach any other entry).

### Steps

1. Create a new class inheriting from `RoomGen<T>` or `PermissiveRoomGen<T>`
2. Add the `[Serializable]` attribute
3. Constrain `T` to `ITiledGenContext`
4. Override `ProposeSize()` to return preferred dimensions
5. Override `DrawOnMap()` to render the room tiles
6. Override `Copy()` for cloning support
7. If not using `PermissiveRoomGen`, override `PrepareFulfillableBorders()`

### When to Use Each Base Class

- **`PermissiveRoomGen<T>`**: All border tiles can accept connections (rectangular rooms)
- **`RoomGen<T>`**: Only specific border tiles can accept connections (caves, irregular shapes)

### Example: Diamond Room

```csharp
[Serializable]
public class RoomGenDiamond<T> : PermissiveRoomGen<T>, ISizedRoomGen
    where T : ITiledGenContext
{
    public RoomGenDiamond() { }

    public RoomGenDiamond(RandRange size)
    {
        this.Size = size;
    }

    protected RoomGenDiamond(RoomGenDiamond<T> other)
    {
        this.Size = other.Size;
    }

    public RandRange Size { get; set; }

    public override RoomGen<T> Copy() => new RoomGenDiamond<T>(this);

    public override Loc ProposeSize(IRandom rand)
    {
        int size = this.Size.Pick(rand);
        return new Loc(size, size);
    }

    public override void DrawOnMap(T map)
    {
        int centerX = this.Draw.Width / 2;
        int centerY = this.Draw.Height / 2;

        for (int x = 0; x < this.Draw.Width; x++)
        {
            for (int y = 0; y < this.Draw.Height; y++)
            {
                int distX = Math.Abs(x - centerX);
                int distY = Math.Abs(y - centerY);
                if (distX + distY <= centerX)
                {
                    map.SetTile(
                        new Loc(this.Draw.X + x, this.Draw.Y + y),
                        map.RoomTerrain.Copy());
                }
            }
        }

        this.SetRoomBorders(map);
    }
}
```

### Register with SpawnList

```csharp
var roomGen = new SpawnList<RoomGen<MyContext>>();
roomGen.Add(new RoomGenSquare<MyContext>(new RandRange(4, 8), new RandRange(4, 8)), 10);
roomGen.Add(new RoomGenDiamond<MyContext>(new RandRange(5, 9)), 5); // lower weight = less common

layout.GenSteps.Add(new Priority(3), new AddRoomStep<MyContext>(roomGen));
```

---

## 2. Add a Custom GenStep

Generation steps are the building blocks of the pipeline. Each step transforms the map in some way.

### Steps

1. Create a class inheriting from `GenStep<T>`
2. Add the `[Serializable]` attribute
3. Constrain `T` to required interfaces (e.g., `ITiledGenContext`, `IFloorPlanGenContext`)
4. Override `Apply(T map)` with your generation logic
5. Use `map.Rand` for all random decisions (ensures reproducibility)
6. Add to pipeline with a `Priority` value

### Example: Border Wall Step

```csharp
[Serializable]
public class BorderWallStep<T> : GenStep<T>
    where T : class, ITiledGenContext
{
    public BorderWallStep() { }

    public BorderWallStep(int thickness)
    {
        this.Thickness = thickness;
    }

    public int Thickness { get; set; } = 1;

    public override void Apply(T map)
    {
        for (int x = 0; x < map.Width; x++)
        {
            for (int y = 0; y < map.Height; y++)
            {
                bool isBorder = x < this.Thickness
                    || y < this.Thickness
                    || x >= map.Width - this.Thickness
                    || y >= map.Height - this.Thickness;

                if (isBorder)
                    map.SetTile(new Loc(x, y), map.WallTerrain.Copy());
            }
        }
    }
}
```

### Add to Pipeline

```csharp
var layout = new MapGen<MyContext>();

// Lower priority = executes first
layout.GenSteps.Add(new Priority(1), new InitTilesStep<MyContext>(50, 50));
layout.GenSteps.Add(new Priority(5), new BorderWallStep<MyContext>(2));
layout.GenSteps.Add(new Priority(10), new PerlinWaterStep<MyContext>(...));

MyContext map = layout.GenMap(seed);
```

---

## 3. Add a Custom Spawnable Type

Spawnables are entities placed on the map (items, enemies, traps, etc.).

### Steps

1. Create a class implementing `ISpawnable`
2. Implement `Copy()` to return a clone
3. Add `IPlaceableGenContext<YourType>` to your context
4. Implement the placement methods in your context
5. Use existing spawn steps or create custom ones

### Example: Trap Spawnable

```csharp
public class Trap : ISpawnable
{
    public Trap() { }

    public Trap(int id, int damage)
    {
        this.ID = id;
        this.Damage = damage;
    }

    protected Trap(Trap other)
    {
        this.ID = other.ID;
        this.Damage = other.Damage;
        this.Loc = other.Loc;
    }

    public int ID { get; set; }
    public int Damage { get; set; }
    public Loc Loc { get; set; }

    public ISpawnable Copy() => new Trap(this);
}
```

### Add to Context

```csharp
public class MapGenContext : BaseMapGenContext<Map>,
    IPlaceableGenContext<Trap>
{
    public List<Trap> Traps { get; } = new List<Trap>();

    List<Loc> IPlaceableGenContext<Trap>.GetAllFreeTiles()
    {
        return Grid.FindTilesInBox(
            Loc.Zero,
            new Loc(this.Width, this.Height),
            loc => !this.IsTileOccupied(loc));
    }

    List<Loc> IPlaceableGenContext<Trap>.GetFreeTiles(Rect rect)
    {
        return Grid.FindTilesInBox(rect.Start, rect.Size,
            loc => !this.IsTileOccupied(loc));
    }

    bool IPlaceableGenContext<Trap>.CanPlaceItem(Loc loc)
    {
        return !this.IsTileOccupied(loc);
    }

    void IPlaceableGenContext<Trap>.PlaceItem(Loc loc, Trap item)
    {
        var trap = new Trap(item.ID, item.Damage) { Loc = loc };
        this.Traps.Add(trap);
    }
}
```

### Spawn Traps

```csharp
var trapSpawner = new PickerSpawner<MyContext, Trap>(
    new LoopedRand<Trap>(
        new RandRange(3, 6), // spawn 3-6 traps
        new SpawnList<Trap>
        {
            { new Trap(1, 10), 10 }, // spike trap
            { new Trap(2, 20), 5 },  // fire trap (rarer)
        }));

layout.GenSteps.Add(new Priority(20),
    new RandomSpawnStep<MyContext, Trap>(trapSpawner));
```

---

## 4. Create a Custom Map Context

The context holds all map state during generation. Interface implementation enables specific GenStep types.

### Interface Summary

| Interface | Enables | Required Members |
|-----------|---------|------------------|
| `IGenContext` | Basic generation | `Rand`, `InitSeed()`, `FinishGen()` |
| `ITiledGenContext` | Tile operations | `Width`, `Height`, `GetTile()`, `SetTile()`, etc. |
| `IFloorPlanGenContext` | Room placement | `RoomPlan`, `InitPlan()` |
| `IRoomGridGenContext` | Grid layouts | `GridPlan`, `InitGrid()` |
| `IPlaceableGenContext<T>` | Entity spawning | `GetAllFreeTiles()`, `PlaceItem()`, etc. |

### Minimal Context (Tiles Only)

```csharp
public class MinimalContext : ITiledGenContext
{
    private ReRandom rand;
    private Tile[][] tiles;

    public IRandom Rand => this.rand;
    public int Width => this.tiles?.Length ?? 0;
    public int Height => this.tiles?[0]?.Length ?? 0;
    public bool Wrap => false;
    public bool TilesInitialized => this.tiles != null;
    public ITile RoomTerrain => new Tile(0);
    public ITile WallTerrain => new Tile(1);

    public void InitSeed(ulong seed)
    {
        this.rand = new ReRandom(seed);
    }

    public void CreateNew(int width, int height, bool wrap = false)
    {
        this.tiles = new Tile[width][];
        for (int x = 0; x < width; x++)
        {
            this.tiles[x] = new Tile[height];
            for (int y = 0; y < height; y++)
                this.tiles[x][y] = new Tile(1); // walls
        }
    }

    public ITile GetTile(Loc loc) => this.tiles[loc.X][loc.Y];
    public void SetTile(Loc loc, ITile tile) => this.tiles[loc.X][loc.Y] = (Tile)tile;
    public bool CanSetTile(Loc loc, ITile tile) => true;
    public bool TrySetTile(Loc loc, ITile tile) { this.SetTile(loc, tile); return true; }
    public bool TileBlocked(Loc loc) => this.tiles[loc.X][loc.Y].ID == 1;
    public bool TileBlocked(Loc loc, bool diagonal) => this.TileBlocked(loc);
    public void FinishGen() { }
}
```

### Full Context (Rooms + Spawning)

See `/RogueElements.Examples/Ex6_Items/MapGenContext.cs` for a complete example with:
- Grid-based room generation (`IRoomGridGenContext`)
- Floor plan support (`IFloorPlanGenContext`)
- Multiple spawnable types (`IPlaceableGenContext<Item>`, `IPlaceableGenContext<Mob>`)
- Stair placement with view support (`IViewPlaceableGenContext<StairsUp>`)

---

## 5. Integrate with Game Engine

RogueElements generates abstract map data. You bridge to your engine in the context.

### General Pattern

```csharp
public class GameMapContext : ITiledGenContext
{
    // Your engine's map representation
    public YourGameMap GameMap { get; private set; }

    public void CreateNew(int width, int height, bool wrap = false)
    {
        // Create your engine's map
        this.GameMap = new YourGameMap(width, height);
    }

    public void SetTile(Loc loc, ITile tile)
    {
        // Convert RogueElements tile to your engine's format
        this.GameMap.SetCell(loc.X, loc.Y, ConvertTile(tile));
    }

    public void FinishGen()
    {
        // Any post-processing your engine needs
        this.GameMap.RebuildNavMesh();
    }
}
```

### Unity Integration

```csharp
public class UnityMapContext : ITiledGenContext
{
    public Tilemap FloorTilemap { get; set; }
    public Tilemap WallTilemap { get; set; }
    public TileBase FloorTile { get; set; }
    public TileBase WallTile { get; set; }

    public void SetTile(Loc loc, ITile tile)
    {
        Vector3Int pos = new Vector3Int(loc.X, loc.Y, 0);
        if (((Tile)tile).ID == 0) // floor
            this.FloorTilemap.SetTile(pos, this.FloorTile);
        else
            this.WallTilemap.SetTile(pos, this.WallTile);
    }
}
```

### MonoGame Integration

```csharp
public class MonoGameContext : ITiledGenContext
{
    public int[,] TileData { get; private set; }

    public void CreateNew(int width, int height, bool wrap = false)
    {
        this.TileData = new int[width, height];
    }

    public void SetTile(Loc loc, ITile tile)
    {
        this.TileData[loc.X, loc.Y] = ((Tile)tile).ID;
    }

    // In your Draw method:
    // for (int x = 0; x < width; x++)
    //     for (int y = 0; y < height; y++)
    //         spriteBatch.Draw(tileTextures[TileData[x,y]], ...);
}
```

### Godot Integration

```csharp
public class GodotMapContext : ITiledGenContext
{
    public TileMap TileMapNode { get; set; }

    public void SetTile(Loc loc, ITile tile)
    {
        int tileId = ((Tile)tile).ID;
        this.TileMapNode.SetCell(0, new Vector2I(loc.X, loc.Y), 0, new Vector2I(tileId, 0));
    }
}
```

### Copy After Generation

If you prefer generating to an intermediate format first:

```csharp
// Generate with RogueElements
var layout = new MapGen<SimpleContext>();
// ... add steps ...
SimpleContext generated = layout.GenMap(seed);

// Copy to your game's map
for (int x = 0; x < generated.Width; x++)
{
    for (int y = 0; y < generated.Height; y++)
    {
        int tileId = ((Tile)generated.GetTile(new Loc(x, y))).ID;
        yourGameMap.SetTile(x, y, tileId);
    }
}

// Copy spawned entities
foreach (var item in generated.Items)
    yourGameMap.SpawnItem(item.ID, item.Loc.X, item.Loc.Y);
```

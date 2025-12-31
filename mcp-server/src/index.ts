#!/usr/bin/env node
/**
 * MCP Server for RogueElements
 *
 * Provides documentation resources, class browsing, search, and code generation tools
 * for working with the RogueElements procedural map generation library.
 *
 * Uses tree-sitter for proper AST-based C# parsing to extract XML documentation.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import Parser from "web-tree-sitter";
type Language = Parser.Language;
type SyntaxNode = Parser.SyntaxNode;

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =============================================================================
// DIRECTORY DISCOVERY
// =============================================================================

function findDocsDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../docs/claude"),
    path.resolve(__dirname, "../docs/claude"),
    path.resolve(process.cwd(), "docs/claude"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return path.resolve(process.cwd(), "docs/claude");
}

function findRogueElementsDir(): string {
  const candidates = [
    path.resolve(__dirname, "../../RogueElements"),
    path.resolve(__dirname, "../RogueElements"),
    path.resolve(process.cwd(), "RogueElements"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }

  return path.resolve(process.cwd(), "RogueElements");
}

const DOCS_DIR = findDocsDir();
const ROGUE_DIR = findRogueElementsDir();

// =============================================================================
// TREE-SITTER INITIALIZATION
// =============================================================================

let csharpParser: Parser | null = null;
let csharpLanguage: Language | null = null;

async function initializeParser(): Promise<void> {
  if (csharpParser) return;

  await Parser.init();
  csharpParser = new Parser();

  // Load C# grammar - try multiple locations
  const wasmCandidates = [
    path.resolve(__dirname, "../node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
    path.resolve(__dirname, "../../node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
    path.resolve(process.cwd(), "mcp-server/node_modules/tree-sitter-c-sharp/tree-sitter-c_sharp.wasm"),
  ];

  let wasmPath: string | null = null;
  for (const candidate of wasmCandidates) {
    if (fs.existsSync(candidate)) {
      wasmPath = candidate;
      break;
    }
  }

  if (!wasmPath) {
    throw new Error("Could not find tree-sitter-c_sharp.wasm");
  }

  csharpLanguage = await Parser.Language.load(wasmPath);
  csharpParser.setLanguage(csharpLanguage);
}

// =============================================================================
// TREE-SITTER HELPERS
// =============================================================================

function findNodesByType(node: SyntaxNode, type: string, results: SyntaxNode[] = []): SyntaxNode[] {
  if (node.type === type) results.push(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) findNodesByType(child, type, results);
  }
  return results;
}

function getDocComments(node: SyntaxNode): string {
  const comments: string[] = [];
  let prev = node.previousSibling;

  while (prev && prev.type === "comment") {
    comments.unshift(prev.text);
    prev = prev.previousSibling;
  }

  return comments.join("\n");
}

function parseDocComment(docText: string): { summary: string; remarks: string; inheritdoc: boolean } {
  const summaryMatch = docText.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);
  const summary = summaryMatch
    ? summaryMatch[1].replace(/^\s*\/\/\/\s*/gm, "").trim()
    : "";

  const remarksMatch = docText.match(/<remarks>\s*([\s\S]*?)\s*<\/remarks>/);
  const remarks = remarksMatch
    ? remarksMatch[1].replace(/^\s*\/\/\/\s*/gm, "").trim()
    : "";

  const inheritdoc = docText.includes("<inheritdoc");

  return { summary, remarks, inheritdoc };
}

function getFieldText(node: SyntaxNode, fieldName: string): string {
  const field = node.childForFieldName(fieldName);
  return field ? field.text : "";
}

// =============================================================================
// CLASS CATEGORIES
// =============================================================================

const CLASS_CATEGORIES = {
  genstep: {
    dirs: ["MapGen"],
    baseClasses: ["GenStep", "IGenStep"],
    description: "Generation pipeline steps - the building blocks of map generation",
    recursive: true
  },
  roomgen: {
    dirs: ["MapGen/Rooms"],
    baseClasses: ["RoomGen", "PermissiveRoomGen", "IRoomGen"],
    description: "Room shape generators - define how individual rooms are shaped",
    recursive: true
  },
  gridpath: {
    dirs: ["MapGen/Grid/Paths"],
    baseClasses: [], // Include all - GridPathStartStep, IGridPathBranch, etc.
    description: "Grid traversal algorithms - create room layouts on a grid",
    recursive: true
  },
  floorpath: {
    dirs: ["MapGen/FloorPlan/Paths"],
    baseClasses: [], // Include all - FloorPathStartStep, IFloorPathBranch, etc.
    description: "Floor plan path generators - create connected room layouts",
    recursive: true
  },
  spawning: {
    dirs: ["MapGen/Spawning"],
    baseClasses: [], // Include all spawning classes
    description: "Entity spawning - place items, enemies, stairs on maps",
    recursive: true
  },
  tiles: {
    dirs: ["MapGen/Tiles"],
    baseClasses: [], // Include all tile-related classes
    description: "Tile manipulation steps - water, terrain, cleanup operations",
    recursive: true
  },
  rand: {
    dirs: ["Rand"],
    baseClasses: [], // Include all public classes
    description: "RNG utilities - SpawnList, RandRange, noise generators",
    recursive: true
  },
  context: {
    dirs: ["MapGen"],
    baseClasses: ["IGenContext", "ITiledGenContext", "IFloorPlanGenContext", "IRoomGridGenContext", "IPlaceableGenContext", "IViewPlaceableGenContext", "IReplaceableGenContext", "ISpawningGenContext"],
    description: "Context interfaces - define map generation capabilities",
    recursive: true, // Changed: need to find interfaces in subdirs
    interfacesOnly: true
  },
  priority: {
    dirs: ["Priority"],
    baseClasses: [],
    description: "Priority system - ordering mechanism for generation steps",
    recursive: true
  },
  floorplan: {
    dirs: ["MapGen/FloorPlan"],
    baseClasses: [], // Include all - FloorPlan has no base class
    description: "Floor plan data structures - room and hallway management",
    recursive: false
  },
  gridplan: {
    dirs: ["MapGen/Grid"],
    baseClasses: [], // Include all - GridPlan has no base class
    description: "Grid plan data structures - grid-based room layout",
    recursive: false
  },
  core: {
    dirs: [""],
    baseClasses: [], // Include all root-level utility classes
    description: "Core utilities - Loc, Rect, Grid, BlobMap, math helpers",
    recursive: false
  }
} as const;

type ClassCategory = keyof typeof CLASS_CATEGORIES;

// =============================================================================
// CLASS DOCUMENTATION PARSING
// =============================================================================

interface ClassDoc {
  name: string;
  namespace: string;
  baseClass: string;
  interfaces: string[];
  summary: string;
  remarks: string;
  properties: Array<{ name: string; type: string; summary: string }>;
  methods: Array<{ name: string; signature: string; summary: string }>;
  filePath: string;
  isInterface: boolean;
  isStruct: boolean;
  isAbstract: boolean;
  isGeneric: boolean;
  genericParams: string;
}

async function parseClassFile(filePath: string): Promise<ClassDoc[]> {
  try {
    await initializeParser();
    if (!csharpParser) return [];

    let content = fs.readFileSync(filePath, "utf-8");

    // Strip UTF-8 BOM if present
    if (content.charCodeAt(0) === 0xFEFF) {
      content = content.slice(1);
    }

    const tree = csharpParser.parse(content);
    if (!tree) return [];

    const results: ClassDoc[] = [];

    // Extract namespace
    const namespaceDecls = findNodesByType(tree.rootNode, "namespace_declaration");
    let namespace = "";
    if (namespaceDecls.length > 0) {
      namespace = getFieldText(namespaceDecls[0], "name");
    }
    // Also check for file-scoped namespace
    const fileScopedNs = findNodesByType(tree.rootNode, "file_scoped_namespace_declaration");
    if (fileScopedNs.length > 0) {
      namespace = getFieldText(fileScopedNs[0], "name");
    }

    // Find all class, struct, and interface declarations
    const classDecls = findNodesByType(tree.rootNode, "class_declaration");
    const structDecls = findNodesByType(tree.rootNode, "struct_declaration");
    const interfaceDecls = findNodesByType(tree.rootNode, "interface_declaration");

    const allDecls = [
      ...classDecls.map(n => ({ node: n, isInterface: false, isStruct: false })),
      ...structDecls.map(n => ({ node: n, isInterface: false, isStruct: true })),
      ...interfaceDecls.map(n => ({ node: n, isInterface: true, isStruct: false }))
    ];

    for (const { node: declNode, isInterface, isStruct } of allDecls) {
      const className = getFieldText(declNode, "name");
      if (!className) continue;

      // Check for generic type parameters
      const typeParams = declNode.childForFieldName("type_parameters");
      const genericParams = typeParams ? typeParams.text : "";
      const isGeneric = !!typeParams;

      // Check modifiers for abstract/public
      let isAbstract = false;
      let isPublic = false;
      for (let i = 0; i < declNode.childCount; i++) {
        const child = declNode.child(i);
        if (child?.type === "modifier") {
          if (child.text === "abstract") isAbstract = true;
          if (child.text === "public") isPublic = true;
        }
      }

      // Skip non-public classes
      if (!isPublic) continue;

      // Get base class and interfaces from base_list
      const baseLists = findNodesByType(declNode, "base_list");
      let baseClass = "";
      const interfaces: string[] = [];

      if (baseLists.length > 0) {
        const baseList = baseLists[0];
        let isFirst = true;
        for (let i = 0; i < baseList.childCount; i++) {
          const child = baseList.child(i);
          if (child && child.type !== ":" && child.type !== ",") {
            const typeName = child.text.split(",")[0].trim();
            if (isFirst && !isInterface) {
              // First item could be base class or interface
              if (typeName.startsWith("I") && typeName.length > 1 && typeName[1] === typeName[1].toUpperCase()) {
                interfaces.push(typeName);
              } else {
                baseClass = typeName;
              }
              isFirst = false;
            } else {
              interfaces.push(typeName);
            }
          }
        }
      }

      // Get doc comments
      const classDoc = getDocComments(declNode);
      const { summary, remarks } = parseDocComment(classDoc);

      // Extract properties and fields
      const properties: ClassDoc["properties"] = [];

      // Fields
      const fieldDecls = findNodesByType(declNode, "field_declaration");
      for (const field of fieldDecls) {
        // Check if public
        let fieldPublic = false;
        for (let i = 0; i < field.childCount; i++) {
          const child = field.child(i);
          if (child?.type === "modifier" && child.text === "public") {
            fieldPublic = true;
            break;
          }
        }
        if (!fieldPublic) continue;

        const fieldDoc = getDocComments(field);
        const { summary: fieldSummary } = parseDocComment(fieldDoc);
        const fieldType = getFieldText(field, "type") || "unknown";

        const variableDeclarators = findNodesByType(field, "variable_declarator");
        for (const declarator of variableDeclarators) {
          const varName = getFieldText(declarator, "name") || declarator.text.split("=")[0].trim();
          properties.push({ name: varName, type: fieldType, summary: fieldSummary || "" });
        }
      }

      // Properties
      const propDecls = findNodesByType(declNode, "property_declaration");
      for (const prop of propDecls) {
        let propPublic = false;
        for (let i = 0; i < prop.childCount; i++) {
          const child = prop.child(i);
          if (child?.type === "modifier" && child.text === "public") {
            propPublic = true;
            break;
          }
        }
        if (!propPublic) continue;

        const propDoc = getDocComments(prop);
        const { summary: propSummary } = parseDocComment(propDoc);
        const propType = getFieldText(prop, "type") || "unknown";
        const propName = getFieldText(prop, "name");

        if (propName) {
          properties.push({ name: propName, type: propType, summary: propSummary || "" });
        }
      }

      // Extract methods
      const methods: ClassDoc["methods"] = [];
      const methodDecls = findNodesByType(declNode, "method_declaration");

      for (const method of methodDecls) {
        let methodPublic = false;
        for (let i = 0; i < method.childCount; i++) {
          const child = method.child(i);
          if (child?.type === "modifier" && child.text === "public") {
            methodPublic = true;
            break;
          }
        }
        if (!methodPublic) continue;

        const methodDoc = getDocComments(method);
        const { summary: methodSummary, inheritdoc } = parseDocComment(methodDoc);

        const methodName = getFieldText(method, "name");
        const returnType = getFieldText(method, "type") || "void";
        const paramsNode = method.childForFieldName("parameters");
        const params = paramsNode ? paramsNode.text : "()";

        const signature = `${returnType} ${methodName}${params}`;

        methods.push({
          name: methodName,
          signature,
          summary: inheritdoc ? "(inherited)" : (methodSummary || "")
        });
      }

      results.push({
        name: className,
        namespace,
        baseClass,
        interfaces,
        summary,
        remarks,
        properties,
        methods,
        filePath,
        isInterface,
        isStruct,
        isAbstract,
        isGeneric,
        genericParams
      });
    }

    return results;
  } catch (err) {
    console.error(`Error parsing ${filePath}:`, err);
    return [];
  }
}

function matchesBaseClass(classDoc: ClassDoc, targetBaseClasses: string[]): boolean {
  if (targetBaseClasses.length === 0) return true; // Match all if no filter

  const { baseClass, interfaces, name } = classDoc;

  for (const target of targetBaseClasses) {
    // Direct base class match
    if (baseClass === target) return true;
    if (baseClass.replace(/<[^>]+>/, "") === target) return true;

    // Interface match
    for (const iface of interfaces) {
      if (iface === target) return true;
      if (iface.replace(/<[^>]+>/, "") === target) return true;
    }

    // Name contains target (for inheritance chains)
    if (baseClass.includes(target)) return true;

    // Self-match for interfaces
    if (classDoc.isInterface && name === target) return true;
  }

  return false;
}

async function findClassesInCategory(category: ClassCategory): Promise<ClassDoc[]> {
  const categoryInfo = CLASS_CATEGORIES[category];
  const classes: ClassDoc[] = [];
  const filesToParse: string[] = [];

  function collectFiles(dir: string, recursive: boolean) {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory() && recursive && !entry.name.startsWith(".") && entry.name !== "obj" && entry.name !== "bin") {
        collectFiles(fullPath, recursive);
      } else if (entry.isFile() && entry.name.endsWith(".cs")) {
        filesToParse.push(fullPath);
      }
    }
  }

  for (const dir of categoryInfo.dirs) {
    const fullDir = path.join(ROGUE_DIR, dir);
    collectFiles(fullDir, categoryInfo.recursive);
  }

  for (const filePath of filesToParse) {
    const fileDocs = await parseClassFile(filePath);
    for (const classDoc of fileDocs) {
      // Filter by interfaces only if specified
      if ((categoryInfo as any).interfacesOnly && !classDoc.isInterface) continue;

      // Filter by base class
      if (matchesBaseClass(classDoc, [...categoryInfo.baseClasses])) {
        classes.push(classDoc);
      }
    }
  }

  return classes;
}

async function findClassByName(className: string): Promise<ClassDoc | null> {
  for (const category of Object.keys(CLASS_CATEGORIES) as ClassCategory[]) {
    const classes = await findClassesInCategory(category);
    const found = classes.find(c => c.name.toLowerCase() === className.toLowerCase());
    if (found) return found;
  }
  return null;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

async function findSimilarClasses(searchName: string, limit: number = 5): Promise<Array<{ name: string; category: string; score: number }>> {
  const searchLower = searchName.toLowerCase();
  const allMatches: Array<{ name: string; category: string; score: number }> = [];

  for (const category of Object.keys(CLASS_CATEGORIES) as ClassCategory[]) {
    const classes = await findClassesInCategory(category);

    for (const cls of classes) {
      const nameLower = cls.name.toLowerCase();
      let score = levenshteinDistance(searchLower, nameLower);

      if (nameLower.includes(searchLower) || searchLower.includes(nameLower)) {
        score = Math.max(0, score - 5);
      }

      const searchParts = searchLower.replace(/step|gen|room|path|plan/gi, "").trim();
      if (searchParts && nameLower.includes(searchParts)) {
        score = Math.max(0, score - 3);
      }

      allMatches.push({ name: cls.name, category, score });
    }
  }

  return allMatches.sort((a, b) => a.score - b.score).slice(0, limit);
}

// =============================================================================
// MCP SERVER SETUP
// =============================================================================

const server = new McpServer({
  name: "rogueelemens-mcp-server",
  version: "2.0.0"
});

// =============================================================================
// RESOURCES - Documentation files
// =============================================================================

const DOC_FILES = ["architecture", "flows", "patterns"] as const;

for (const docName of DOC_FILES) {
  server.resource(
    `rogue-docs-${docName}`,
    `rogue://docs/${docName}`,
    async () => {
      const filePath = path.join(DOCS_DIR, `${docName}.md`);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        return {
          contents: [{
            uri: `rogue://docs/${docName}`,
            mimeType: "text/markdown",
            text: content
          }]
        };
      } catch {
        return {
          contents: [{
            uri: `rogue://docs/${docName}`,
            mimeType: "text/plain",
            text: `Error: Could not read ${docName}.md`
          }]
        };
      }
    }
  );
}

// =============================================================================
// RESOURCES - Class categories (browsable)
// =============================================================================

for (const [category, info] of Object.entries(CLASS_CATEGORIES)) {
  server.resource(
    `rogue-classes-${category}`,
    `rogue://classes/${category}`,
    async () => {
      const classes = await findClassesInCategory(category as ClassCategory);

      const lines = [
        `# ${category} Classes`,
        "",
        `**Description:** ${info.description}`,
        `**Base Classes:** ${info.baseClasses.length > 0 ? info.baseClasses.map(b => `\`${b}\``).join(", ") : "(all public classes)"}`,
        `**Directories:** ${info.dirs.map(d => `\`RogueElements/${d}\``).join(", ")}`,
        `**Count:** ${classes.length}`,
        "",
        "## Classes",
        ""
      ];

      for (const cls of classes) {
        const typeLabel = cls.isInterface ? "[interface]" : cls.isAbstract ? "[abstract]" : "";
        const genericLabel = cls.isGeneric ? cls.genericParams : "";
        lines.push(`### ${cls.name}${genericLabel} ${typeLabel}`);
        if (cls.summary) lines.push(cls.summary);
        if (cls.baseClass) lines.push(`- **Base:** \`${cls.baseClass}\``);
        if (cls.interfaces.length > 0) {
          lines.push(`- **Implements:** ${cls.interfaces.map(i => `\`${i}\``).join(", ")}`);
        }
        if (cls.properties.length > 0) {
          const propNames = cls.properties.slice(0, 5).map(p => p.name).join(", ");
          const more = cls.properties.length > 5 ? `, ... (+${cls.properties.length - 5} more)` : "";
          lines.push(`- **Properties:** ${propNames}${more}`);
        }
        lines.push("");
      }

      return {
        contents: [{
          uri: `rogue://classes/${category}`,
          mimeType: "text/markdown",
          text: lines.join("\n")
        }]
      };
    }
  );
}

// =============================================================================
// PROMPTS
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
2. Override \`ProposeSize(IRandom rand)\` to return room dimensions
3. Override \`DrawOnMap(T map)\` to render the room shape to tiles
4. Implement \`Copy()\` for cloning

Use \`rogue_list_classes\` with category "roomgen" to see existing examples.

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

Use \`rogue_list_classes\` with category "genstep" to see existing examples.

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

Use \`rogue_list_classes\` with category "spawning" to see existing spawning infrastructure.

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

Use \`rogue_list_classes\` with category "context" to see the interface definitions.

What capabilities does your context need?`
      }
    }]
  })
);

// =============================================================================
// TOOLS - Search & Browse
// =============================================================================

server.tool(
  "rogue_search",
  `Search for RogueElements classes across all categories by name or summary.

Searches class names and XML documentation summaries. Returns matches ranked by relevance.
Use this when you're not sure which category a class belongs to, or to find classes related to a concept.

Categories searched: ${Object.keys(CLASS_CATEGORIES).join(", ")}`,
  {
    query: z.string()
      .min(2)
      .describe("Search query (e.g., 'water', 'spawn', 'grid', 'room')"),
    limit: z.number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum results to return")
  },
  async ({ query, limit }) => {
    const queryLower = query.toLowerCase();
    const results: Array<{
      name: string;
      category: ClassCategory;
      summary: string;
      score: number;
      isInterface: boolean;
      isStruct: boolean;
    }> = [];

    for (const category of Object.keys(CLASS_CATEGORIES) as ClassCategory[]) {
      const classes = await findClassesInCategory(category);

      for (const cls of classes) {
        const nameLower = cls.name.toLowerCase();
        const summaryLower = (cls.summary || "").toLowerCase();

        let score = 1000;

        if (nameLower === queryLower) {
          score = 0;
        } else if (nameLower.startsWith(queryLower)) {
          score = 10;
        } else if (nameLower.includes(queryLower)) {
          score = 20;
        } else if (summaryLower.includes(queryLower)) {
          score = 50;
        } else {
          const distance = levenshteinDistance(queryLower, nameLower);
          if (distance <= 3) {
            score = 100 + distance;
          } else {
            continue;
          }
        }

        results.push({
          name: cls.name,
          category,
          summary: cls.summary || "(no documentation)",
          score,
          isInterface: cls.isInterface,
          isStruct: cls.isStruct
        });
      }
    }

    const sorted = results.sort((a, b) => a.score - b.score).slice(0, limit);

    if (sorted.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No classes found matching '${query}'. Try a different search term or use rogue_list_classes to browse by category.`
        }]
      };
    }

    const lines = [
      `# Search Results: "${query}"`,
      "",
      `Found ${sorted.length} matching classes:`,
      "",
      "| Class | Category | Type | Summary |",
      "|-------|----------|------|---------|"
    ];

    for (const result of sorted) {
      const summary = result.summary.length > 50
        ? result.summary.substring(0, 47) + "..."
        : result.summary;
      const typeLabel = result.isInterface ? "interface" : result.isStruct ? "struct" : "class";
      lines.push(`| \`${result.name}\` | ${result.category} | ${typeLabel} | ${summary} |`);
    }

    lines.push("");
    lines.push("*Use `rogue_get_class_docs` for full documentation on any class.*");

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }
);

server.tool(
  "rogue_list_classes",
  `List all RogueElements classes in a specific category.

Categories: ${Object.keys(CLASS_CATEGORIES).join(", ")}

Returns class names with brief summaries from XML documentation.`,
  {
    category: z.enum(Object.keys(CLASS_CATEGORIES) as [ClassCategory, ...ClassCategory[]])
      .describe("Category of classes to list")
  },
  async ({ category }) => {
    const classes = await findClassesInCategory(category);
    const categoryInfo = CLASS_CATEGORIES[category];

    if (classes.length === 0) {
      return {
        content: [{
          type: "text",
          text: `No classes found in category '${category}' (searched ${categoryInfo.dirs.join(", ")})`
        }]
      };
    }

    const lines = [
      `# ${category} Classes`,
      "",
      `**Description:** ${categoryInfo.description}`,
      `**Count:** ${classes.length}`,
      "",
      "| Class | Type | Summary |",
      "|-------|------|---------|"
    ];

    for (const cls of classes) {
      const summary = cls.summary ? cls.summary.substring(0, 60) : "(no docs)";
      const typeLabel = cls.isInterface ? "interface" : cls.isStruct ? "struct" : cls.isAbstract ? "abstract" : "class";
      const generic = cls.isGeneric ? cls.genericParams : "";
      lines.push(`| \`${cls.name}${generic}\` | ${typeLabel} | ${summary} |`);
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }
);

server.tool(
  "rogue_get_class_docs",
  `Get detailed XML documentation for a specific RogueElements class or interface.

Extracts from C# source files:
- Class summary and remarks
- Namespace and base class
- Implemented interfaces
- Public properties with their types and documentation
- Public methods with their signatures and documentation`,
  {
    class_name: z.string()
      .min(1)
      .describe("Name of the class or interface to get documentation for")
  },
  async ({ class_name }) => {
    const classDoc = await findClassByName(class_name);

    if (!classDoc) {
      const suggestions = await findSimilarClasses(class_name, 5);

      let errorMsg = `Class '${class_name}' not found in RogueElements.\n\n`;

      if (suggestions.length > 0) {
        errorMsg += "**Did you mean one of these?**\n\n";
        for (const suggestion of suggestions) {
          errorMsg += `- \`${suggestion.name}\` (${suggestion.category})\n`;
        }
      }

      return {
        content: [{ type: "text", text: errorMsg }]
      };
    }

    const typeLabel = classDoc.isInterface ? "interface" : classDoc.isStruct ? "struct" : classDoc.isAbstract ? "abstract class" : "class";
    const generic = classDoc.isGeneric ? classDoc.genericParams : "";

    const lines = [
      `# ${classDoc.name}${generic}`,
      "",
      `**Type:** ${typeLabel}`,
      `**Namespace:** \`${classDoc.namespace}\``,
    ];

    if (classDoc.baseClass) {
      lines.push(`**Base Class:** \`${classDoc.baseClass}\``);
    }
    if (classDoc.interfaces.length > 0) {
      lines.push(`**Implements:** ${classDoc.interfaces.map(i => `\`${i}\``).join(", ")}`);
    }
    lines.push(`**File:** \`${classDoc.filePath.replace(ROGUE_DIR, "RogueElements")}\``);
    lines.push("");

    if (classDoc.summary) {
      lines.push("## Summary", "", classDoc.summary, "");
    }

    if (classDoc.remarks) {
      lines.push("## Remarks", "", classDoc.remarks, "");
    }

    if (classDoc.properties.length > 0) {
      lines.push("## Properties", "");
      for (const prop of classDoc.properties) {
        lines.push(`### \`${prop.name}\` : \`${prop.type}\``);
        if (prop.summary) lines.push(prop.summary);
        lines.push("");
      }
    }

    if (classDoc.methods.length > 0) {
      lines.push("## Methods", "");
      for (const method of classDoc.methods) {
        lines.push(`### \`${method.signature}\``);
        if (method.summary) lines.push(method.summary);
        lines.push("");
      }
    }

    return {
      content: [{ type: "text", text: lines.join("\n") }]
    };
  }
);

// =============================================================================
// TOOLS - Code Generation (existing)
// =============================================================================

server.tool(
  "rogue_scaffold_roomgen",
  "Generate boilerplate code for a custom RogueElements RoomGen",
  {
    name: z.string()
      .min(1)
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
        public override RoomGen<T> Copy() => new ${className}<T>();

        public override Loc ProposeSize(IRandom rand)
        {
            // TODO: Return appropriate dimensions for ${shape_description}
            int width = rand.Next(5, 10);
            int height = rand.Next(5, 10);
            return new Loc(width, height);
        }

        public override void DrawOnMap(T map)
        {
            // TODO: Implement ${shape_description} shape
            // this.Draw contains the room bounds (X, Y, Width, Height, End)
            for (int x = this.Draw.X; x < this.Draw.End.X; x++)
            {
                for (int y = this.Draw.Y; y < this.Draw.End.Y; y++)
                {
                    Loc loc = new Loc(x, y);
                    // TODO: Add shape logic here
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

server.tool(
  "rogue_scaffold_genstep",
  "Generate boilerplate code for a custom RogueElements GenStep",
  {
    name: z.string()
      .min(1)
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
            // - map.GridPlan.GridWidth, GridHeight: Grid dimensions` : ""}

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
      content: [{ type: "text", text: interfaces }]
    };
  }
);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("RogueElements MCP server v2.0 running via stdio");
}

main().catch(error => {
  console.error("Server error:", error);
  process.exit(1);
});

// <copyright file="Program.cs" company="Audino">
// Copyright (c) Audino
// Licensed under the MIT license. See LICENSE file in the project root for full license information.
// </copyright>

using BenchmarkDotNet.Running;
using RogueElements.Benchmarks;

// Run all benchmarks when no args provided, or specific ones based on args
if (args.Length == 0)
{
    BenchmarkRunner.Run<MapGenerationBenchmarks>();
    BenchmarkRunner.Run<RoomGenBenchmarks>();
    BenchmarkRunner.Run<RngBenchmarks>();
}
else
{
    BenchmarkSwitcher.FromAssembly(typeof(MapGenerationBenchmarks).Assembly).Run(args);
}

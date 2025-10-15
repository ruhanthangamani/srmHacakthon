# cycles.py
# Utility for cycle detection in waste material graph

from typing import List, Dict, Any

def detect_cycles(graph: Dict[str, List[str]]) -> List[List[str]]:
    """
    Detect all simple cycles in a directed graph.
    graph: { node: [neighbors] }
    Returns: List of cycles (each cycle is a list of node ids)
    """
    cycles = []
    path = []
    visited = set()

    def dfs(node, start):
        path.append(node)
        visited.add(node)
        for neighbor in graph.get(node, []):
            if neighbor == start:
                cycles.append(path.copy())
            elif neighbor not in path:
                dfs(neighbor, start)
        path.pop()
        visited.discard(node)

    for node in graph:
        dfs(node, node)
    # Remove duplicate cycles (cycles with same nodes but different start)
    unique = []
    seen = set()
    for cycle in cycles:
        key = tuple(sorted(cycle))
        if key not in seen:
            unique.append(cycle)
            seen.add(key)
    return unique

# Example usage:
# graph = { 'A': ['B'], 'B': ['C'], 'C': ['A'] }
# print(detect_cycles(graph))

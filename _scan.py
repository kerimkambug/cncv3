import re
mlist = {}
import glob, os
for f in glob.glob("server/ai_service/**/*", recursive=True):
    pass
algs = ["Astar", "AstarR", "AstarL", "KStarSearch_", "MCTS_PATHFINDING_", "KStar_", "_MAX_PATHS", "MAX_SOLUTION_LENGTH", "DEF_MAX_SOLUTION", "DEF_MAX_SOLUTION_LENGTH", "MAX_SOLUTION", "MULTI_COMBAT_AI", "MULTI_COMBAT", "DEF_MULTI_COMBAT", "isUsingMultiCombat", "flowReduction", "FLOW_REDUCTION", "flowCap", "shouldContributeFlow", "FLOWCONTRIBUTE", "contributeFlow", "contributeToFlow", "calculateFlowReduction", "flowContribution", "SumSquares", "sumOfSquares", "prodOfSquares", "productOfSquares", "weightedSum", "nZones", "densityMap", "DENSITY", "densityWeight", "zoneDensity", "DensityWeight", "maxDensity", "zoneWeight", "ZONE_WEIGHT", "zonePenalty", "_density", "mSumsSquares", "IKernelDensity", "nParSqrt", "n_par_sqrt", "sqrtN", "squareN", "zMatrix", "ZKernel", "Z_AVG", "Z_MEAN", "SZCore", "ZTarget", "ZStops", "INFINITY_", "ACHIEVE_Z", "Z_INFINITY", "percentSqrt"]
found = {}
for b in algs:
    c = 0
    locs = []
    for root, dirs, files in os.walk("server"):
        for fn in files:
            if fn.endswith((".java", ".kt")) or fn == "gradle.properties":
                p = os.path.join(root, fn)
                try:
                    if os.path.getsize(p) > 8000000: continue
                    txt = open(p, encoding="utf-8", errors="ignore").read()
                except: continue
                if b in txt:
                    c += 1
                    locs.append(p)
    if c:
        found[b] = (c, locs)
for k in sorted(found):
    print(k, "=>", found[k][0], "|", "; ".join(os.path.relpath(x) for x in sorted(set(found[k][1]))[:4]))

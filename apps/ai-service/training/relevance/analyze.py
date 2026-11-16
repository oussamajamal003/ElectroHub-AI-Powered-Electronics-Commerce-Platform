import ast
import csv
import hashlib
import json
import sys

import numpy as np

B = sys.argv[1]
CAT_CSV = sys.argv[2]
idx = np.load(f"{B}/index.npz")
q = np.load(f"{B}/queries.npz")
head = np.load(f"{B}/imagenet_head.npz")
meta = [ast.literal_eval(m) for m in q["meta"]]
prod = {r["product_id"]: r for r in csv.DictReader(open(CAT_CSV, encoding="utf-8"))}
pids = sorted(set(idx["pids"]))
pindex = {p: i for i, p in enumerate(pids)}
pcat = np.array([prod[p]["category"] for p in pids])
pfam = np.array([prod[p]["appearance_family"] for p in pids])
S = q["emb"] @ idx["emb"].T
P = np.full((len(meta), len(pids)), -2.0)
for j, p in enumerate(idx["pids"]):
    P[:, pindex[p]] = np.maximum(P[:, pindex[p]], S[:, j])
logits = q["feat"] @ head["w"].T + head["b"]
logits -= logits.max(1, keepdims=True)
prob = np.exp(logits)
prob /= prob.sum(1, keepdims=True)
names = list(head["names"])
CATMAP = {  # ImageNet class -> ElectroHub category (classes with a clear catalog counterpart)
    "laptop": "laptops",
    "notebook": "laptops",
    "hand-held computer": "smartphones",
    "cellular telephone": "smartphones",
    "iPod": "smartphones",
    "computer keyboard": "keyboards-mice",
    "typewriter keyboard": "keyboards-mice",
    "space bar": "keyboards-mice",
    "mouse": "keyboards-mice",
    "monitor": "monitors",
    "screen": "monitors",
    "desktop computer": "monitors",
    "television": "monitors",
    "reflex camera": "cameras-photography",
    "Polaroid camera": "cameras-photography",
    "lens cap": "cameras-photography",
    "loudspeaker": "speakers-audio",
    "printer": "printers-scanners",
    "modem": "networking-wifi",
    "joystick": "gaming",
    "digital watch": "smartwatches",
    "hard disc": "storage-ssds",
}
ELEC = set(CATMAP) | {
    "radio",
    "CD player",
    "cassette player",
    "tape player",
    "remote control",
    "projector",
    "home theater",
    "microphone",
    "oscilloscope",
    "switch",
    "web site",
    "dial telephone",
    "pay-phone",
    "stopwatch",
    "analog clock",
    "digital clock",
    "binoculars",
    "tripod",
    "electric guitar",
    "harmonica",
    "joystick",
    "car mirror",
    "crossword puzzle",
    "envelope",
    "carton",
    "packet",
    "rule",
    "slide rule",
    "calculator",
    "abacus",
    "magnetic compass",
    "barometer",
    "scale",
    "plate rack",
    "radiator",
    "iron",
    "power drill",
    "chain",
    "buckle",
    "lighter",
    "pencil sharpener",
    "maraca",
    "punching bag",
}
cats = sorted(set(pcat))
ci = {c: i for i, c in enumerate(cats)}
nid = {n: i for i, n in enumerate(names)}
emass = prob[:, [nid[n] for n in ELEC if n in nid]].sum(1)
pc = np.zeros((len(meta), len(cats)))
for n, c in CATMAP.items():
    pc[:, ci[c]] += prob[:, nid[n]]


def split(m):  # family/label-level split; OOD by label so test OOD classes are unseen in calibration
    if m["group"] == "ood":
        return "test" if m["label"] in {"washing-machine", "refrigerator", "cat", "shoe", "bicycle", "fruit"} else "cal"
    if m["split"] == "probe":
        return "cal" if int(hashlib.sha256(m["path"].encode()).hexdigest(), 16) % 2 else "test"
    if m["split"] == "validation":
        return "cal"
    if m["split"] == "unseen_sku_gallery":
        return "cal" if int(hashlib.sha256(m["label"].encode()).hexdigest(), 16) % 2 else "test"
    return "test"


sp = np.array([split(m) for m in meta])
grp = np.array([m["group"] for m in meta])


def rank(i, lam, conf):
    s = P[i].copy()
    if lam and pc[i].max() >= conf:
        s = s + lam * pc[i][[ci[c] for c in pcat]]
    o = np.argsort(-s, kind="stable")
    return o, P[i][o]


def run(sel, tau, delta, emin, lam, conf, K=12):
    st = dict(
        n_in=0,
        rej_in=0,
        cat1=0,
        cat5=0,
        catprec=0.0,
        ex_n=0,
        ex1=0,
        ex5=0,
        n_ood=0,
        acc_ood=0,
        n_adj=0,
        acc_adj=0,
        adj_cat1=0,
        kept=0,
    )
    for i in np.where(sel)[0]:
        o, sims = rank(i, lam, conf)
        keep = [j for j, sv in zip(o[:K], sims[:K], strict=True) if sv >= tau and sv >= sims[0] - delta]
        if emass[i] < emin:
            keep = []
        m = meta[i]
        if m["group"] == "ood":
            st["n_ood"] += 1
            st["acc_ood"] += bool(keep)
            continue
        if m["group"] == "adjacent":
            st["n_adj"] += 1
            st["acc_adj"] += bool(keep)
            st["adj_cat1"] += bool(keep) and pcat[keep[0]] == m["category"]
            continue
        st["n_in"] += 1
        st["kept"] += len(keep)
        if not keep:
            st["rej_in"] += 1
            continue
        st["cat1"] += pcat[keep[0]] == m["category"]
        st["cat5"] += any(pcat[j] == m["category"] for j in keep[:5])
        st["catprec"] += np.mean([pcat[j] == m["category"] for j in keep])
        ex = set(np.where(pfam == m["label"])[0])
        if ex:
            st["ex_n"] += 1
            st["ex1"] += keep[0] in ex
            st["ex5"] += bool(ex & set(keep[:5]))
    return st


def fmt(st):
    n = st["n_in"]
    a = n - st["rej_in"]
    return dict(
        n_in=n,
        false_reject=f"{st['rej_in']}/{n}",
        catR1=f"{st['cat1']}/{n}",
        catR5=f"{st['cat5']}/{n}",
        catPrec_accepted=round(st["catprec"] / max(a, 1), 3),
        exactR1=f"{st['ex1']}/{st['ex_n']}",
        exactR5=f"{st['ex5']}/{st['ex_n']}",
        ood_accepted=f"{st['acc_ood']}/{st['n_ood']}",
        adjacent_accepted=f"{st['acc_adj']}/{st['n_adj']}",
        adjacent_catR1=st["adj_cat1"],
        mean_kept=round(st["kept"] / max(a, 1), 1),
    )


if __name__ == "__main__":
    mode = sys.argv[3]
    if mode == "dist":
        for g in ["in", "adjacent", "ood"]:
            for s_ in ["cal", "test"]:
                sel = (grp == g) & (sp == s_)
                s1 = P[sel].max(1)
                print(
                    g,
                    s_,
                    sel.sum(),
                    "s1 pct10/50/90",
                    np.round(np.percentile(s1, [10, 50, 90]), 3) if sel.any() else "",
                    "emass pct10/50/90",
                    np.round(np.percentile(emass[sel], [10, 50, 90]), 3) if sel.any() else "",
                )
    else:
        print(json.dumps({k: fmt(run(sp == k, -1, 9, 0, 0, 1)) for k in ["cal", "test"]}, indent=1))
if __name__ == "__main__" and sys.argv[3] == "grid":
    cal = sp == "cal"
    res = []
    for emin in [0, 0.05, 0.08, 0.1, 0.12, 0.15, 0.2]:
        for tau in [-1, 0.35, 0.4, 0.45, 0.5]:
            for delta in [9, 0.3, 0.2, 0.15, 0.1]:
                for lam in [0, 0.1, 0.2, 0.3]:
                    st = run(cal, tau, delta, emin, lam, 0.3)
                    fr = st["rej_in"] / st["n_in"]
                    fp = st["acc_ood"] / st["n_ood"]
                    a = st["n_in"] - st["rej_in"]
                    res.append(
                        (
                            fr <= 0.10,
                            -fp,
                            st["cat1"],
                            st["catprec"] / max(a, 1),
                            emin,
                            tau,
                            delta,
                            lam,
                            round(fr, 3),
                            round(fp, 3),
                        )
                    )
    res.sort(reverse=True)
    for r in res[:12]:
        print(r)
    sel = sys.argv[4:]
    if sel:
        e, t, d, lam_ = map(float, sel)
        print(json.dumps({k: fmt(run(sp == k, t, d, e, lam_, 0.3)) for k in ["cal", "test"]}, indent=1))

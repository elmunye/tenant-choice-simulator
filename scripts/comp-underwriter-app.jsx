    const PERSONAS = [
      { id: "emory_grad", name: "Emory-area grad", line: "Walkability and commute time drive choices; rent increases bite quickly." },
      { id: "vahi_professional", name: "Virginia-Highland professional", line: "Neighborhood fit and finishes matter; pays for premium when it clears the bar." },
      { id: "empty_nester", name: "Empty nester downsizer", line: "Ease, services, and security weigh heavily; less sensitive to small rent spreads." },
      { id: "skeptical_renter_control", name: "Value-focused renter", line: "Concessions and perceived deal quality move the needle; skeptical of headline rent." },
    ];

    const MIX_PRESETS = {
      decatur: { emory_grad: 38, vahi_professional: 12, empty_nester: 18, skeptical_renter_control: 32 },
      emory: { emory_grad: 45, vahi_professional: 10, empty_nester: 17, skeptical_renter_control: 28 },
      vahi: { emory_grad: 15, vahi_professional: 42, empty_nester: 23, skeptical_renter_control: 20 },
    };

    function coefMapFromRows(rows) {
      const m = new Map();
      for (const row of rows) m.set(row.feature, row.coef);
      return m;
    }
    const personaCoefMaps = {};
    for (const [k, rows] of Object.entries(PERSONA_COEFS_RAW)) {
      personaCoefMaps[k] = coefMapFromRows(rows);
    }

    function priceBeta(coefMap) {
      return coefMap.get("Price_num") ?? NaN;
    }

    function levelLabelFromProperty(attr, prop) {
      const aid = prop.attributes[attr];
      const def = ATTRIBUTES.find((a) => a.id === attr);
      const lv = def && def.levels.find((l) => l.id === aid);
      return lv ? lv.label : null;
    }

    function numericFromProperty(attr, prop) {
      const aid = prop.attributes[attr];
      const def = ATTRIBUTES.find((a) => a.id === attr);
      const lv = def && def.levels.find((l) => l.id === aid);
      if (!lv) return NaN;
      if (attr === "Size" || attr === "Price") return lv.numericValue;
      return NaN;
    }

    function propertyUtility(profile, coefMap, propIndex) {
      let util = 0;
      const sizeN = numericFromProperty("Size", profile);
      const priceN = numericFromProperty("Price", profile);
      util += (coefMap.get("Size_num") || 0) * sizeN;
      util += (coefMap.get("Price_num") || 0) * priceN;
      if (propIndex === 1) util += coefMap.get("ASC_B") || 0;
      else if (propIndex === 2) util += coefMap.get("ASC_C") || 0;
      else if (propIndex > 2) util += coefMap.get("ASC_C") || 0;
      for (const attr of ENGINE_ATTR_NAMES) {
        if (attr === "Size" || attr === "Price") continue;
        const level = levelLabelFromProperty(attr, profile);
        if (!level) continue;
        const baseline = BASELINE_LEVEL_LABEL[attr];
        if (level === baseline) continue;
        const feat = attr + "__" + level;
        const c = coefMap.get(feat);
        if (c != null) util += c;
      }
      return util;
    }

    function marketShareForPersona(properties, coefMap) {
      const utils = properties.map((p, i) => propertyUtility(p, coefMap, i));
      const maxU = Math.max(...utils);
      const expU = utils.map((u) => Math.exp(u - maxU));
      const s = expU.reduce((a, b) => a + b, 0);
      return expU.map((e) => e / s);
    }

    function normalizeWeights(w) {
      const keys = PERSONAS.map((p) => p.id);
      let sum = 0;
      const o = {};
      for (const k of keys) {
        const v = Math.max(0, Number(w[k]) || 0);
        o[k] = v;
        sum += v;
      }
      if (sum <= 0) {
        const eq = 100 / keys.length;
        keys.forEach((k) => (o[k] = eq));
        sum = 100;
      }
      for (const k of keys) o[k] = (o[k] / sum) * 100;
      return o;
    }

    function runSimulation({ properties, personaWeights }) {
      const w = normalizeWeights(personaWeights);
      const personaIds = PERSONAS.map((p) => p.id);
      const personaShares = {};
      let any = false;
      for (const pid of personaIds) {
        const cmap = personaCoefMaps[pid];
        const pb = priceBeta(cmap);
        if (!(pb < 0)) continue;
        personaShares[pid] = marketShareForPersona(properties, cmap);
        any = true;
      }
      const n = properties.length;
      const propertyShares = new Array(n).fill(0);
      const personaSubjectShares = {};
      let wsum = 0;
      for (const pid of personaIds) {
        const sh = personaShares[pid];
        if (!sh) continue;
        const wi = w[pid] / 100;
        wsum += wi;
        personaSubjectShares[pid] = sh[0];
        for (let i = 0; i < n; i++) propertyShares[i] += wi * sh[i];
      }
      if (wsum > 0 && wsum < 1) {
        for (let i = 0; i < n; i++) propertyShares[i] /= wsum;
      }
      return { propertyShares, personaShares, personaWeightsUsed: w, personaSubjectShares };
    }

    function coefForLevel(coefMap, attr, levelLabel) {
      const baseline = BASELINE_LEVEL_LABEL[attr];
      if (!levelLabel || levelLabel === baseline) return 0;
      const f = attr + "__" + levelLabel;
      return coefMap.has(f) ? coefMap.get(f) : 0;
    }

    function numericForSizeLabel(label) {
      const def = ATTRIBUTES.find((a) => a.id === "Size");
      const lv = def && def.levels.find((l) => l.label === label);
      return lv && lv.numericValue != null ? lv.numericValue : NaN;
    }

    function calculateWTPForPersona(coefMap, attr, fromLabel, toLabel) {
      const bp = priceBeta(coefMap);
      if (!(bp < 0)) return NaN;
      if (attr === "Size") {
        const fromN = numericForSizeLabel(fromLabel);
        const toN = numericForSizeLabel(toLabel);
        if (!Number.isFinite(fromN) || !Number.isFinite(toN)) return NaN;
        const bs = coefMap.get("Size_num") || 0;
        return (-bs * (toN - fromN)) / bp;
      }
      const delta = coefForLevel(coefMap, attr, toLabel) - coefForLevel(coefMap, attr, fromLabel);
      return -delta / bp;
    }

    function wtpMix(personaWeights, attr, fromLabel, toLabel) {
      const w = normalizeWeights(personaWeights);
      let acc = 0,
        tw = 0;
      for (const pid of PERSONAS.map((p) => p.id)) {
        const cmap = personaCoefMaps[pid];
        const val = calculateWTPForPersona(cmap, attr, fromLabel, toLabel);
        if (!Number.isFinite(val)) continue;
        const wi = w[pid] / 100;
        acc += wi * val;
        tw += wi;
      }
      return tw > 0 ? acc / tw : NaN;
    }

    function findLevelDef(attr, levelId) {
      const def = ATTRIBUTES.find((a) => a.id === attr);
      return def && def.levels.find((l) => l.id === levelId);
    }

    const PRIMARY_ATTRIBUTES = ["Price", "Size", "Location", "Finishes", "Walkability"];

    function formatAttributeLabel(attrId, label) {
      if (attrId === "Price") {
        const m = label.match(/\$[\d,]+/);
        return m ? m[0] + " /mo" : label;
      }
      if (attrId === "Size") {
        const m = label.match(/[\d,]+ SF/);
        return m ? m[0] : label;
      }
      return label.replace(/\s*\(.*?\)\s*$/, "").trim();
    }

    function IconDownload() {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
        </svg>
      );
    }
    function IconShare() {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
          <path d="M8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98" />
        </svg>
      );
    }
    function IconWand() {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M15 4l5 5M9 19l-5 5M4 9l11 11M12 2l2 2M7 11l2 2" />
        </svg>
      );
    }
    function IconDollar() {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    }
    function IconUsers() {
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      );
    }
    function IconChevronDown() {
      return (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    }
    function IconChevronUp() {
      return (
        <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 15l-6-6-6 6" />
        </svg>
      );
    }
    function IconLightbulb() {
      return (
        <svg className="w-4 h-4 text-slate-500 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.74V17h8v-2.26A7 7 0 0 0 12 2z" />
        </svg>
      );
    }

    function ShareBar({ properties, shares, subjectColor, compColors }) {
      return (
        <div className="max-w-[520px]">
          <div className="flex h-2 rounded overflow-hidden mb-2">
            {properties.map((p, i) => {
              const pct = shares[i] * 100;
              const color = i === 0 ? subjectColor : compColors[(i - 1) % compColors.length];
              return (
                <div
                  key={p.id}
                  style={{ width: pct + "%", background: color }}
                  className={i > 0 ? "border-l-2 border-white" : ""}
                  title={p.name + " " + pct.toFixed(0) + "%"}
                />
              );
            })}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            {properties.map((p, i) => {
              const color = i === 0 ? subjectColor : compColors[(i - 1) % compColors.length];
              return (
                <div key={p.id} className="flex items-center gap-1.5">
                  <span className="inline-block w-2 h-2 rounded-sm" style={{ background: color }} />
                  <span>
                    {i === 0 ? "Subject" : p.name} {(shares[i] * 100).toFixed(0)}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }

    function ComparisonTable({ subject, comps, shares, attributes, subjectColor }) {
      const renderCell = (compProp, attrId, attrIsNumeric) => {
        const subjectLevelId = subject.attributes[attrId];
        const compLevelId = compProp.attributes[attrId];
        const attribute = ATTRIBUTES.find((a) => a.id === attrId);
        if (!attribute) return null;
        if (subjectLevelId === compLevelId) {
          return <span className="text-slate-400">Same</span>;
        }
        const compLevel = attribute.levels.find((l) => l.id === compLevelId);
        const subjectLevel = attribute.levels.find((l) => l.id === subjectLevelId);
        const compLabel = formatAttributeLabel(attribute.id, compLevel ? compLevel.label : compLevelId);
        let delta = null;
        if (attrIsNumeric && compLevel && subjectLevel && compLevel.numericValue != null && subjectLevel.numericValue != null) {
          const diff = compLevel.numericValue - subjectLevel.numericValue;
          const sign = diff > 0 ? "+" : "−";
          const abs = Math.abs(diff);
          delta = attribute.id === "Price" ? sign + "$" + abs.toLocaleString() : sign + abs.toLocaleString();
        }
        return (
          <div className="flex items-baseline gap-2">
            <span className="text-amber-900">{compLabel}</span>
            {delta && <span className="text-[11px] text-slate-500 tabular-nums">{delta}</span>}
          </div>
        );
      };
      return (
        <div className="border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm" style={{ tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: "24%" }} />
              <col style={{ width: 76 / (comps.length + 1) + "%" }} />
              {comps.map((c) => (
                <col key={c.id} style={{ width: 76 / (comps.length + 1) + "%" }} />
              ))}
            </colgroup>
            <thead className="bg-slate-50">
              <tr>
                <th className="text-left px-3 py-2.5 font-medium text-slate-500 text-xs border-b border-slate-200">Attribute</th>
                <th className="text-left px-3 py-2.5 font-medium border-b border-slate-200">
                  <div className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: subjectColor }} />
                    <span className="text-sm">Subject</span>
                  </div>
                  <div className="text-[11px] text-slate-400 font-normal mt-0.5">Your deal</div>
                </th>
                {comps.map((comp, i) => (
                  <th key={comp.id} className="text-left px-3 py-2.5 font-medium border-b border-slate-200">
                    <div className="text-sm truncate">{comp.name}</div>
                    <div className="text-[11px] text-slate-400 font-normal mt-0.5 tabular-nums">{(shares[i + 1] * 100).toFixed(0)}% share</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {attributes.map((attr, rowIdx) => {
                const subjectLevelId = subject.attributes[attr.id];
                const subjectLevel = attr.levels.find((l) => l.id === subjectLevelId);
                const subjectLabel = formatAttributeLabel(attr.id, subjectLevel ? subjectLevel.label : subjectLevelId || "—");
                const isLast = rowIdx === attributes.length - 1;
                return (
                  <tr key={attr.id}>
                    <td className={"px-3 py-2.5 text-slate-500 " + (!isLast ? "border-b border-slate-200" : "")}>
                      {attr.name.replace(/\s*\(.*?\)\s*/, "")}
                    </td>
                    <td className={"px-3 py-2.5 " + (!isLast ? "border-b border-slate-200" : "")}>{subjectLabel}</td>
                    {comps.map((comp) => {
                      const isDifferent = comp.attributes[attr.id] !== subjectLevelId;
                      return (
                        <td
                          key={comp.id}
                          className={"px-3 py-2.5 " + (isDifferent ? "bg-amber-50 " : "") + (!isLast ? "border-b border-slate-200" : "")}
                        >
                          {renderCell(comp, attr.id, attr.isNumeric)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      );
    }

    function InsightBanner({ subject, comps, leadingCompIdx, subjectShare, compShares, onTryChange }) {
      const message = useMemo(() => {
        if (leadingCompIdx <= 0) {
          const bestComp = compShares.length ? Math.max(...compShares) : 0;
          return (
            "Your subject is the demand leader at " +
            subjectShare.toFixed(0) +
            "% share. The closest competitor sits at " +
            bestComp.toFixed(0) +
            "%."
          );
        }
        const leadingComp = comps[leadingCompIdx - 1];
        const leadingShare = compShares[leadingCompIdx - 1];
        const subjectPriceId = subject.attributes["Price"];
        const compPriceId = leadingComp.attributes["Price"];
        if (subjectPriceId && compPriceId && subjectPriceId !== compPriceId) {
          const priceAttr = ATTRIBUTES.find((a) => a.id === "Price");
          const subjectPrice = priceAttr && priceAttr.levels.find((l) => l.id === subjectPriceId);
          const compPrice = priceAttr && priceAttr.levels.find((l) => l.id === compPriceId);
          const sp = subjectPrice && subjectPrice.numericValue;
          const cp = compPrice && compPrice.numericValue;
          if (cp < sp) {
            return (
              leadingComp.name +
              " is winning on price. At $" +
              cp.toLocaleString() +
              " it's $" +
              (sp - cp).toLocaleString() +
              "/mo below subject — most of its " +
              leadingShare.toFixed(0) +
              "% share comes from that."
            );
          }
        }
        return (
          leadingComp.name +
          " leads at " +
          leadingShare.toFixed(0) +
          "%. The biggest differences from subject are in finishes, security, and rent — try a change to see which moves the needle most."
        );
      }, [subject, comps, leadingCompIdx, subjectShare, compShares]);
      return (
        <div className="mt-4 flex items-start gap-2.5 px-3.5 py-3 bg-slate-50 rounded-lg border border-slate-200">
          <IconLightbulb />
          <div className="text-[13px] leading-relaxed text-slate-600">
            <span className="text-slate-900">{message}</span>
            <button type="button" onClick={onTryChange} className="ml-1.5 text-slate-900 underline decoration-slate-400 hover:decoration-slate-900">
              Try a change →
            </button>
          </div>
        </div>
      );
    }

    function ComparisonView({
      properties,
      result,
      dealName,
      onAddComp,
      onTryChange,
      onOpenWTP,
      onOpenRenterMix,
      onExport,
      onShare,
    }) {
      const [showAllAttributes, setShowAllAttributes] = useState(false);
      const subject = properties[0];
      const comps = properties.slice(1);
      const subjectShare = result.propertyShares[0] * 100;
      const displayedAttributes = useMemo(
        () => (showAllAttributes ? ATTRIBUTES : ATTRIBUTES.filter((a) => PRIMARY_ATTRIBUTES.includes(a.id))),
        [showAllAttributes]
      );
      const hiddenCount = ATTRIBUTES.length - PRIMARY_ATTRIBUTES.length;
      const leadingCompIdx = useMemo(() => {
        if (comps.length === 0) return -1;
        const compShares = result.propertyShares.slice(1);
        return compShares.indexOf(Math.max(...compShares)) + 1;
      }, [result, comps.length]);
      const subjectShareColor = "#185FA5";
      const compShareColors = ["#94A3B8", "#CBD5E1", "#E2E8F0"];
      return (
        <div className="bg-white text-slate-900 text-[13px]">
          <header className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
            <div className="flex items-center gap-3 min-w-0">
              <h1 className="text-sm font-medium tracking-tight">Comp Underwriter</h1>
              <span className="text-slate-400 text-sm">·</span>
              <span className="text-sm text-slate-500 truncate">{dealName}</span>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={onExport} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md transition-colors">
                <IconDownload /> Export
              </button>
              <button type="button" onClick={onShare} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md transition-colors">
                <IconShare /> Share
              </button>
            </div>
          </header>
          <section className="px-6 pt-6 pb-5">
            <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500 mb-1.5">Predicted demand share</div>
            <div className="flex items-baseline gap-3.5 mb-2">
              <div className="text-[44px] font-medium leading-none tabular-nums text-slate-900">
                {subjectShare.toFixed(0)}
                <span className="text-2xl text-slate-400 ml-0.5">%</span>
              </div>
              <div className="text-sm text-slate-500">
                subject captures of demand vs. {comps.length} {comps.length === 1 ? "comp" : "comps"}
              </div>
            </div>
            <ShareBar properties={properties} shares={result.propertyShares} subjectColor={subjectShareColor} compColors={compShareColors} />
          </section>
          <div className="flex flex-wrap gap-2 px-6 pb-5 border-b border-slate-200">
            <button type="button" onClick={onTryChange} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-900 border border-slate-300 rounded-md hover:bg-slate-50 transition-colors">
              <IconWand /> Try a change
            </button>
            <button type="button" onClick={onOpenWTP} className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
              <IconDollar /> What renters would pay for…
            </button>
            <button type="button" onClick={onOpenRenterMix} className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-700 border border-slate-200 rounded-md hover:bg-slate-50 transition-colors">
              <IconUsers /> Adjust renter mix
            </button>
          </div>
          <section className="px-6 py-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[15px] font-medium">How they compare</h2>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="inline-block w-2 h-2 bg-amber-100 border border-amber-400 rounded-sm" />
                Differences from subject
              </div>
            </div>
            <ComparisonTable subject={subject} comps={comps} shares={result.propertyShares} attributes={displayedAttributes} subjectColor={subjectShareColor} />
            {hiddenCount > 0 && (
              <button type="button" onClick={() => setShowAllAttributes((v) => !v)} className="mt-3 flex items-center gap-1 text-xs text-slate-700 hover:underline">
                {showAllAttributes ? <IconChevronUp /> : <IconChevronDown />}
                {showAllAttributes ? "Hide secondary attributes" : "Show " + hiddenCount + " more attributes"}
              </button>
            )}
            <InsightBanner
              subject={subject}
              comps={comps}
              leadingCompIdx={leadingCompIdx}
              subjectShare={subjectShare}
              compShares={result.propertyShares.slice(1).map((s) => s * 100)}
              onTryChange={onTryChange}
            />
            <button type="button" onClick={onAddComp} className="mt-4 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              + Add comp
            </button>
          </section>
        </div>
      );
    }

    const WTP_CATEGORY = {
      Size: "operational",
      Price: "operational",
      MoveInSpecial: "operational",
      Location: "operational",
      CommuteToWork: "operational",
      Walkability: "amenity",
      Finishes: "capex",
      Parking: "capex",
      Security: "capex",
      Rooftop: "capex",
      Coworking: "amenity",
      PetAmenities: "amenity",
      PackageHandling: "amenity",
    };

    function cloneProperty(p) {
      return { ...p, attributes: { ...p.attributes } };
    }

    function applyAttributeChanges(base, changes) {
      const out = cloneProperty(base);
      for (const ch of changes) {
        out.attributes[ch.attr] = ch.toId;
      }
      return out;
    }

    function TryChangePanel({ properties, personaWeights, onClose, onApply, initialChanges, initialChangesKey }) {
      const [pending, setPending] = useState(() => (initialChanges && initialChanges.length ? initialChanges.slice() : []));
      const subject = properties[0];
      const baseResult = useMemo(() => runSimulation({ properties, personaWeights }), [properties, personaWeights]);
      const modifiedSubject = useMemo(() => applyAttributeChanges(subject, pending), [subject, pending]);
      const propsAfter = useMemo(() => {
        const rest = properties.slice(1);
        return [modifiedSubject, ...rest];
      }, [modifiedSubject, properties]);
      const afterResult = useMemo(() => runSimulation({ properties: propsAfter, personaWeights }), [propsAfter, personaWeights]);
      const beforePct = baseResult.propertyShares[0] * 100;
      const afterPct = afterResult.propertyShares[0] * 100;
      const delta = afterPct - beforePct;

      useEffect(() => {
        if (initialChanges && initialChanges.length) setPending(initialChanges.map((c) => ({ ...c })));
        else setPending([]);
      }, [initialChangesKey]);

      const addAnother = () => {
        const used = new Set(pending.map((p) => p.attr));
        const nextAttr = ATTRIBUTES.find((a) => !used.has(a.id) && a.levels.length > 1);
        if (!nextAttr) return;
        const effective = applyAttributeChanges(subject, pending);
        const curId = effective.attributes[nextAttr.id];
        const other = nextAttr.levels.find((l) => l.id !== curId);
        if (!other) return;
        setPending((p) => [...p, { attr: nextAttr.id, fromId: curId, toId: other.id }]);
      };

      const explanation = useMemo(() => {
        if (!pending.length) return "Add a change to see how demand share shifts for the subject.";
        const parts = [];
        for (const ch of pending) {
          const def = ATTRIBUTES.find((a) => a.id === ch.attr);
          const fromL = def && def.levels.find((l) => l.id === ch.fromId);
          const toL = def && def.levels.find((l) => l.id === ch.toId);
          if (!def || !fromL || !toL) continue;
          const w = wtpMix(personaWeights, ch.attr, fromL.label, toL.label);
          if (Number.isFinite(w)) parts.push(formatAttributeLabel(def.id, toL.label) + " (~$" + Math.abs(w).toFixed(0) + "/mo implied value)");
        }
        return "Most of the move comes from: " + parts.join("; ") + ".";
      }, [pending, personaWeights]);

      const maxBar = Math.max(0.01, ...baseResult.propertyShares, ...afterResult.propertyShares);

      return (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.08)] border border-slate-200 max-h-[90vh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-[15px] font-medium text-slate-900">Try a change</h2>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="text-xs px-2 py-1 border border-slate-200 rounded-md text-slate-600 hover:bg-slate-50"
                onClick={() => {
                  const name = "Scenario " + new Date().toLocaleString();
                  onApply({ saveOnly: true, name, pending: [...pending] });
                }}
              >
                Save scenario
              </button>
              <button type="button" className="text-slate-500 hover:text-slate-800 text-sm px-2" onClick={onClose} aria-label="Close">
                ✕
              </button>
            </div>
          </div>
          <div className="p-5 overflow-y-auto flex-1 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Pending changes (subject)</div>
              <div className="flex flex-wrap gap-2 mb-3">
                {["Renovation", "Concession", "Custom"].map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="text-xs px-2 py-1 rounded-md border border-slate-200 text-slate-700 hover:bg-slate-50"
                    onClick={() => {
                      if (label === "Renovation") {
                        const fin = ATTRIBUTES.find((a) => a.id === "Finishes");
                        const prem = fin && fin.levels.find((l) => l.label.includes("Premium"));
                        if (prem) setPending([{ attr: "Finishes", fromId: subject.attributes.Finishes, toId: prem.id }]);
                      } else if (label === "Concession") {
                        const mi = ATTRIBUTES.find((a) => a.id === "MoveInSpecial");
                        const two = mi && mi.levels.find((l) => l.label.includes("2 months"));
                        if (two) setPending([{ attr: "MoveInSpecial", fromId: subject.attributes.MoveInSpecial, toId: two.id }]);
                      } else setPending([]);
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <ul className="space-y-2">
                {pending.map((ch, idx) => {
                  const def = ATTRIBUTES.find((a) => a.id === ch.attr);
                  const fromL = def && def.levels.find((l) => l.id === ch.fromId);
                  const toL = def && def.levels.find((l) => l.id === ch.toId);
                  return (
                    <li key={idx} className="text-sm border border-slate-200 rounded-lg px-3 py-2 flex justify-between gap-2">
                      <div>
                        <div className="text-xs text-slate-500 mb-0.5">{def && def.name}</div>
                        <div>
                          <span className="line-through text-slate-400">{fromL && formatAttributeLabel(def.id, fromL.label)}</span>
                          <span className="text-slate-400"> → </span>
                          <span className="font-medium text-slate-900">{toL && formatAttributeLabel(def.id, toL.label)}</span>
                        </div>
                      </div>
                      <button type="button" className="text-xs text-slate-500 shrink-0 hover:text-slate-800" onClick={() => setPending((p) => p.filter((_, i) => i !== idx))}>
                        Reset
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button type="button" className="mt-3 text-sm text-slate-600 hover:underline" onClick={addAnother}>
                + Add another change
              </button>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Subject share</div>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="tabular-nums text-slate-900">{beforePct.toFixed(1)}%</span>
                <span className="text-slate-400">→</span>
                <span className="tabular-nums text-slate-900">{afterPct.toFixed(1)}%</span>
                <span className={"text-sm font-medium tabular-nums " + (delta >= 0 ? "text-emerald-700" : "text-red-700")}>
                  ({delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)} pp)
                </span>
              </div>
              <div className="text-[11px] text-slate-500 mb-3">Population-weighted vs. current comps</div>
              {properties.map((p, i) => (
                <div key={p.id} className="mb-2">
                  <div className="text-xs text-slate-600 mb-0.5 truncate">{i === 0 ? "Subject" : p.name}</div>
                  <div className="flex gap-1 items-center">
                    <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden flex">
                      <div className="h-full" style={{ width: (baseResult.propertyShares[i] / maxBar) * 100 + "%", background: i === 0 ? "#185FA5" : "#94A3B8" }} />
                    </div>
                    <span className="text-[10px] text-slate-400 w-8">{(baseResult.propertyShares[i] * 100).toFixed(0)}</span>
                    <div className="flex-1 h-2 bg-slate-100 rounded overflow-hidden flex">
                      <div className="h-full" style={{ width: (afterResult.propertyShares[i] / maxBar) * 100 + "%", background: i === 0 ? "#185FA5" : "#CBD5E1" }} />
                    </div>
                    <span className="text-[10px] text-slate-500 w-8">{(afterResult.propertyShares[i] * 100).toFixed(0)}</span>
                  </div>
                </div>
              ))}
              <p className="text-[13px] text-slate-600 mt-4 leading-relaxed border-t border-slate-200 pt-3">{explanation}</p>
              <button
                type="button"
                className="mt-4 w-full py-2 text-sm font-medium border border-slate-900 text-slate-900 rounded-lg hover:bg-slate-50"
                onClick={() => onApply({ pending })}
              >
                Apply to comparison
              </button>
            </div>
          </div>
        </div>
      );
    }

    function WTPPanel({ properties, personaWeights, onClose, onTryRow }) {
      const subject = properties[0];
      const [personaSel, setPersonaSel] = useState("mix");
      const [filter, setFilter] = useState("all");
      const rows = useMemo(() => {
        const out = [];
        for (const attr of ATTRIBUTES) {
          const curId = subject.attributes[attr.id];
          const cur = attr.levels.find((l) => l.id === curId);
          if (!cur) continue;
          for (const lv of attr.levels) {
            if (lv.id === curId) continue;
            const mixVal = wtpMix(personaWeights, attr.id, cur.label, lv.label);
            const perVals = PERSONAS.map((p) => {
              const cmap = personaCoefMaps[p.id];
              return calculateWTPForPersona(cmap, attr.id, cur.label, lv.label);
            }).filter(Number.isFinite);
            const vmin = perVals.length ? Math.min(...perVals) : NaN;
            const vmax = perVals.length ? Math.max(...perVals) : NaN;
            const displayVal = personaSel === "mix" ? mixVal : calculateWTPForPersona(personaCoefMaps[personaSel], attr.id, cur.label, lv.label);
            if (!Number.isFinite(displayVal)) continue;
            out.push({
              attr: attr.id,
              attrName: attr.name,
              fromId: curId,
              toId: lv.id,
              desc: formatAttributeLabel(attr.id, cur.label) + " → " + formatAttributeLabel(attr.id, lv.label),
              mixVal,
              displayVal,
              vmin,
              vmax,
              cat: WTP_CATEGORY[attr.id] || "operational",
            });
          }
        }
        out.sort((a, b) => Math.abs(b.mixVal) - Math.abs(a.mixVal));
        return out;
      }, [subject, personaWeights, personaSel]);
      const filtered = (filter === "all" ? rows : rows.filter((r) => r.cat === filter)).slice().sort((a, b) => Math.abs(b.mixVal) - Math.abs(a.mixVal));
      const absMax = Math.max(50, ...filtered.map((r) => Math.max(Math.abs(r.vmin), Math.abs(r.vmax), Math.abs(r.displayVal))));

      const insight = useMemo(() => {
        const pos = rows.filter((r) => r.mixVal > 0);
        const neg = rows.filter((r) => r.mixVal < 0);
        pos.sort((a, b) => b.mixVal - a.mixVal);
        neg.sort((a, b) => a.mixVal - b.mixVal);
        let s = "";
        if (pos[0]) s += "Largest positive lever under the current mix: " + pos[0].desc + " (~$" + pos[0].mixVal.toFixed(0) + "/mo). ";
        if (neg[0]) s += "Watch negatives: " + neg[0].desc + " (~$" + neg[0].mixVal.toFixed(0) + "/mo).";
        return s || "Adjust filters or renter mix to explore tradeoffs.";
      }, [rows]);

      return (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.08)] border border-slate-200 max-h-[90vh] overflow-hidden flex flex-col max-w-4xl w-full">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-[15px] font-medium">What renters would pay for…</h2>
            <button type="button" className="text-slate-500 hover:text-slate-800 text-sm px-2" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="px-5 py-3 border-b border-slate-200 flex flex-wrap gap-2 items-center">
            <label className="text-xs text-slate-500 mr-1">Persona view</label>
            <select className="text-sm border border-slate-200 rounded-md px-2 py-1" value={personaSel} onChange={(e) => setPersonaSel(e.target.value)}>
              <option value="mix">Current mix (weighted)</option>
              {PERSONAS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="px-5 py-2 flex flex-wrap gap-2 border-b border-slate-200">
            {[
              { id: "all", label: "All" },
              { id: "capex", label: "Capex" },
              { id: "amenity", label: "Amenity" },
              { id: "operational", label: "Operational levers" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilter(f.id)}
                className={"text-xs px-2 py-1 rounded-md border " + (filter === f.id ? "border-slate-900 bg-slate-50" : "border-slate-200 text-slate-600 hover:bg-slate-50")}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="overflow-auto flex-1 px-5 py-3">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                  <th className="py-2 pr-2">Upgrade</th>
                  <th className="py-2 pr-2 w-24">Value /mo</th>
                  <th className="py-2 pr-2 min-w-[140px]">Range</th>
                  <th className="py-2 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100">
                    <td className="py-2 pr-2 text-slate-800">
                      <div className="font-medium text-slate-900">{r.attrName}</div>
                      <div className="text-xs text-slate-500">{r.desc}</div>
                    </td>
                    <td className={"py-2 pr-2 tabular-nums " + (r.displayVal < 0 ? "text-red-700" : "text-slate-900")}>${r.displayVal.toFixed(0)}</td>
                    <td className="py-2 pr-2">
                      <div className="relative h-4 flex items-center">
                        <div className="absolute inset-x-0 h-1.5 bg-slate-100 rounded" />
                        {Number.isFinite(r.vmin) && Number.isFinite(r.vmax) && (
                          <div
                            className="absolute h-1.5 bg-slate-300 rounded"
                            style={{
                              left: ((Math.min(r.vmin, r.vmax, 0) + absMax) / (2 * absMax)) * 100 + "%",
                              width: (Math.abs(r.vmax - r.vmin) / (2 * absMax)) * 100 + "%",
                            }}
                          />
                        )}
                        <div
                          className="absolute w-1.5 h-3 bg-slate-600 rounded-sm top-1/2 -translate-y-1/2"
                          style={{ left: ((r.displayVal + absMax) / (2 * absMax)) * 100 + "%", marginLeft: "-3px" }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 mt-0.5">
                        ${r.vmin.toFixed(0)} – ${r.vmax.toFixed(0)}
                      </div>
                    </td>
                    <td className="py-2">
                      <button type="button" className="text-xs text-slate-900 underline" onClick={() => onTryRow([{ attr: r.attr, fromId: r.fromId, toId: r.toId }])}>
                        Try →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-slate-200 bg-slate-50 text-[13px] text-slate-600 rounded-b-xl">{insight}</div>
        </div>
      );
    }

    function detectMixPreset(w) {
      const n = normalizeWeights(w);
      for (const key of ["decatur", "emory", "vahi"]) {
        const m = MIX_PRESETS[key];
        let ok = true;
        for (const p of PERSONAS) {
          if (Math.abs(n[p.id] - m[p.id]) > 2) ok = false;
        }
        if (ok) return key;
      }
      return "custom";
    }

    function RenterMixPanel({ properties, personaWeights, onClose, onApply }) {
      const baseResult = useMemo(() => runSimulation({ properties, personaWeights }), [properties, personaWeights]);
      const beforePct = baseResult.propertyShares[0] * 100;
      const [draft, setDraft] = useState(() => normalizeWeights(personaWeights));
      const [preset, setPreset] = useState(() => detectMixPreset(personaWeights));
      const afterResult = useMemo(() => runSimulation({ properties, personaWeights: draft }), [properties, draft]);
      const afterPct = afterResult.propertyShares[0] * 100;

      const setFromPreset = (key) => {
        setPreset(key);
        if (key === "custom") return;
        const m = MIX_PRESETS[key];
        if (m) setDraft({ ...m });
      };

      const onSlider = (pid, newVal) => {
        const keys = PERSONAS.map((p) => p.id);
        const v = Math.min(100, Math.max(0, newVal));
        const old = { ...draft };
        const rem = 100 - v;
        let others = 0;
        for (const k of keys) if (k !== pid) others += old[k];
        const next = { ...old, [pid]: v };
        if (others <= 0) {
          const eq = rem / (keys.length - 1);
          for (const k of keys) if (k !== pid) next[k] = eq;
        } else {
          for (const k of keys) if (k !== pid) next[k] = rem * (old[k] / others);
        }
        let s = 0;
        for (const k of keys) s += next[k];
        if (Math.abs(s - 100) > 0.01) {
          const fix = 100 - s;
          const other = keys.find((k) => k !== pid);
          next[other] = (next[other] || 0) + fix;
        }
        setDraft(next);
      };

      return (
        <div className="bg-white rounded-xl shadow-[0_8px_30px_rgba(15,23,42,0.08)] border border-slate-200 max-h-[90vh] overflow-y-auto max-w-4xl w-full">
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
            <h2 className="text-[15px] font-medium">Adjust renter mix</h2>
            <button type="button" className="text-slate-500 hover:text-slate-800 text-sm px-2" onClick={onClose}>
              ✕
            </button>
          </div>
          <div className="p-5">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-6">
              {[
                { id: "decatur", label: "Decatur" },
                { id: "emory", label: "Emory area" },
                { id: "vahi", label: "Virginia-Highland" },
                { id: "custom", label: "Custom" },
              ].map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setFromPreset(c.id)}
                  className={
                    "border rounded-lg px-3 py-2 text-left text-sm transition-colors " +
                    (preset === c.id ? "border-slate-900 bg-slate-50" : "border-slate-200 hover:bg-slate-50")
                  }
                >
                  <div className="font-medium text-slate-900">{c.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">{c.id === "custom" ? "Keep sliders as-is" : "Preset weights"}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div>
                {PERSONAS.map((p) => (
                  <div key={p.id} className="mb-4">
                    <div className="flex justify-between text-sm text-slate-900 mb-1">
                      <span className="font-medium">{p.name}</span>
                      <span className="tabular-nums text-slate-500">{draft[p.id].toFixed(0)}%</span>
                    </div>
                    <input type="range" min={0} max={100} step={1} value={draft[p.id]} onChange={(e) => onSlider(p.id, Number(e.target.value))} className="w-full" />
                    <p className="text-xs text-slate-500 mt-1 leading-snug">{p.line}</p>
                  </div>
                ))}
              </div>
              <div>
                <div className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-2">Subject share</div>
                <div className="flex items-baseline gap-2 mb-4">
                  <span className="text-2xl font-medium tabular-nums">{beforePct.toFixed(1)}%</span>
                  <span className="text-slate-400">→</span>
                  <span className="text-2xl font-medium tabular-nums">{afterPct.toFixed(1)}%</span>
                </div>
                <div className="text-xs text-slate-500 mb-2">Share of demand on subject, by persona</div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200">
                      <th className="py-1">Persona</th>
                      <th className="py-1 tabular-nums">Before</th>
                      <th className="py-1 tabular-nums">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PERSONAS.map((p) => {
                      const b = baseResult.personaShares[p.id];
                      const a = afterResult.personaShares[p.id];
                      const b0 = b ? b[0] * 100 : null;
                      const a0 = a ? a[0] * 100 : null;
                      return (
                        <tr key={p.id} className="border-b border-slate-100">
                          <td className="py-1.5 text-slate-700">{p.name}</td>
                          <td className="py-1.5 tabular-nums text-slate-600">{b0 != null ? b0.toFixed(1) + "%" : "—"}</td>
                          <td className="py-1.5 tabular-nums text-slate-900">{a0 != null ? a0.toFixed(1) + "%" : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <button type="button" className="mt-6 w-full py-2.5 text-sm font-medium border border-slate-900 text-slate-900 rounded-lg hover:bg-slate-50" onClick={() => onApply(draft)}>
              Apply mix
            </button>
          </div>
        </div>
      );
    }

    function cloneDefaultProperties() {
      const d = ATTR_PACK.defaults;
      return [
        JSON.parse(JSON.stringify(d.subject)),
        JSON.parse(JSON.stringify(d.compA)),
        JSON.parse(JSON.stringify(d.compB)),
      ];
    }

    function App() {
      const [properties, setProperties] = useState(cloneDefaultProperties);
      const [personaWeights, setPersonaWeights] = useState(MIX_PRESETS.decatur);
      const [activePanel, setActivePanel] = useState(null);
      const [tryInitial, setTryInitial] = useState(null);
      const [tryInitialKey, setTryInitialKey] = useState(0);
      const [savedScenarios, setSavedScenarios] = useState([]);

      const result = useMemo(() => runSimulation({ properties, personaWeights }), [properties, personaWeights]);

      useEffect(() => {
        if (!activePanel) return;
        const handler = (e) => {
          if (e.key === "Escape") setActivePanel(null);
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
      }, [activePanel]);

      const dealName = "450 W Ponce de Leon Ave, Decatur, GA · 1BR / 1,000 SF · $1,950/mo · Mid-tier finishes · Tier 1 security · Surface parking · Walkable errands";

      const addComp = () => {
        const compsCount = properties.length - 1;
        const newId = "comp-" + Date.now();
        setProperties([
          ...properties,
          {
            id: newId,
            name: "Comp " + String.fromCharCode(65 + compsCount),
            attributes: { ...properties[0].attributes },
          },
        ]);
      };

      const openTry = (initial) => {
        setTryInitial(initial && initial.length ? initial : null);
        setTryInitialKey((k) => k + 1);
        setActivePanel("tryChange");
      };

      return (
        <div className="min-h-screen bg-slate-50 text-slate-900 antialiased text-[13px]">
          <div className="max-w-5xl mx-auto bg-white min-h-screen border-x border-slate-200">
            <ComparisonView
              properties={properties}
              result={result}
              dealName={dealName}
              onAddComp={addComp}
              onTryChange={() => openTry(null)}
              onOpenWTP={() => setActivePanel("wtp")}
              onOpenRenterMix={() => setActivePanel("renterMix")}
              onExport={() => {
                const blob = new Blob([JSON.stringify({ properties, personaWeights, savedScenarios }, null, 2)], { type: "application/json" });
                const a = document.createElement("a");
                a.href = URL.createObjectURL(blob);
                a.download = "comp-underwriter-export.json";
                a.click();
              }}
              onShare={() => navigator.clipboard.writeText("Subject share: " + (result.propertyShares[0] * 100).toFixed(1) + "%")}
            />
          </div>
          {activePanel && (
            <div
              className="fixed inset-0 bg-slate-900/40 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
              onClick={() => setActivePanel(null)}
            >
              <div className="my-8 w-full flex justify-center" onClick={(e) => e.stopPropagation()}>
                {activePanel === "tryChange" && (
                  <TryChangePanel
                    properties={properties}
                    personaWeights={personaWeights}
                    initialChanges={tryInitial}
                    initialChangesKey={tryInitialKey}
                    onClose={() => setActivePanel(null)}
                    onApply={(payload) => {
                      if (payload.saveOnly) {
                        setSavedScenarios((s) => [...s, { name: payload.name, at: new Date().toISOString(), pending: payload.pending }]);
                        return;
                      }
                      const sub = properties[0];
                      const next = { ...sub, attributes: { ...sub.attributes } };
                      for (const ch of payload.pending) next.attributes[ch.attr] = ch.toId;
                      setProperties([next, ...properties.slice(1)]);
                      setActivePanel(null);
                    }}
                  />
                )}
                {activePanel === "wtp" && (
                  <WTPPanel
                    properties={properties}
                    personaWeights={personaWeights}
                    onClose={() => setActivePanel(null)}
                    onTryRow={(ch) => {
                      setTryInitial(ch);
                      setTryInitialKey((k) => k + 1);
                      setActivePanel("tryChange");
                    }}
                  />
                )}
                {activePanel === "renterMix" && (
                  <RenterMixPanel
                    properties={properties}
                    personaWeights={personaWeights}
                    onClose={() => setActivePanel(null)}
                    onApply={(w) => {
                      setPersonaWeights(w);
                      setActivePanel(null);
                    }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

// дашборд по заказам: vue для состояния и фильтров, d3 для графиков
const { createApp, nextTick } = Vue;

const CAT_ICON = {
  "База": "🥛", "Фрукты": "🍎", "Овощи": "🥦", "Готовая еда": "🍱", "Сладости": "🍫",
  "Вода": "💧", "Напитки": "🧃", "Товары для дома": "🧽", "Снеки": "🥨", "Аптека": "💊",
  "Услуги Лавки": "🛵",
};
const SERVICES = "Услуги Лавки";
const TOP_N = 15;

const nf = new Intl.NumberFormat("ru-RU");
const monthKey = s => s.slice(0, 7);
const addMonths = (key, n) => {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const MONTHS_LONG = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function aggregate(rows) {
  const orders = new Set();
  let spend = 0, full = 0;
  for (const r of rows) { orders.add(r[0]); spend += r[5] * r[6]; full += r[4] * r[6]; }
  return { orders: orders.size, spend, full, disc: full ? 1 - spend / full : 0 };
}

createApp({
  data: () => ({
    ready: false, items: [], cats: [], rows: [], images: {},
    selected: new Set(), metric: "qty", period: 24,
    tip: { show: false, x: 0, y: 0, kind: null, d: {} },
  }),

  computed: {
    lastMonth() { return this.rows.length ? monthKey(this.rows[this.rows.length - 1][1]) : "2000-01"; },
    firstMonth() { return this.rows.length ? monthKey(this.rows[0][1]) : "2000-01"; },
    yoyMonth() { return addMonths(this.lastMonth, -12); },
    months24() { return d3.range(23, -1, -1).map(i => addMonths(this.lastMonth, -i)); },
    totalOrders() { return new Set(this.rows.map(r => r[0])).size; },

    filtered() {
      if (!this.selected.size) return this.rows;
      return this.rows.filter(r => this.selected.has(r[3]));
    },
    byMonth() {
      const g = d3.group(this.filtered, r => monthKey(r[1]));
      return new Map([...g].map(([m, rs]) => [m, aggregate(rs)]));
    },
    monthly() {
      const empty = { orders: 0, spend: 0, full: 0, disc: 0 };
      return this.months24.map(m => ({ m, ...(this.byMonth.get(m) || empty) }));
    },
    kpis() {
      const get = (m, k) => (this.byMonth.get(m) || { orders: 0, spend: 0, disc: 0 })[k];
      const avg = k => d3.mean(this.monthly, d => d[k]);
      const m = this.lastMonth, p = addMonths(m, -1), y = this.yoyMonth;
      return [
        { key: "orders", label: "Заказов", fmt: this.fmtInt, unit: "abs" },
        { key: "spend", label: "Сумма трат", fmt: this.fmtRub, unit: "pct" },
        { key: "disc", label: "Средняя скидка", fmt: this.fmtPct, unit: "pp" },
      ].map(k => ({ ...k, cur: get(m, k.key), prev: get(p, k.key), yoy: get(y, k.key), avg: avg(k.key) }));
    },

    periodRows() {
      if (!this.period) return this.rows;
      const from = this.months24[0];
      return this.rows.filter(r => monthKey(r[1]) >= from);
    },
    itemStats() {
      const rows = this.periodRows.filter(r =>
        this.cats[r[3]] !== SERVICES && (!this.selected.size || this.selected.has(r[3])));
      const g = d3.rollup(rows, rs => ({
        qty: d3.sum(rs, r => r[6]),
        spend: d3.sum(rs, r => r[5] * r[6]),
        orders: new Set(rs.map(r => r[0])).size,
      }), r => r[2]);
      return [...g].map(([idx, s]) => ({ idx, ...this.items[idx], ...s }));
    },
    topItems() {
      return [...this.itemStats].sort((a, b) => b[this.metric] - a[this.metric]).slice(0, TOP_N);
    },
    catStats() {
      const total = d3.sum(this.periodRows, r => r[5] * r[6]);
      const months = this.period ? this.months24 : null;
      return d3.groups(this.periodRows, r => r[3]).map(([idx, rs]) => {
        const a = aggregate(rs);
        const bm = d3.rollup(rs, v => d3.sum(v, r => r[5] * r[6]), r => monthKey(r[1]));
        const ms = months || [...new Set(this.rows.map(r => monthKey(r[1])))];
        const vals = ms.map(m => bm.get(m) || 0);
        const x = d3.scaleLinear([0, vals.length - 1], [0, 120]);
        const y = d3.scaleLinear([0, d3.max(vals) || 1], [27, 1]);
        return { idx, name: this.cats[idx], ...a, share: a.spend / total, spark: d3.line((v, i) => x(i), y)(vals) };
      }).sort((a, b) => b.spend - a.spend);
    },
    maxShare() { return d3.max(this.catStats, c => c.share); },
    catTopItems() {
      const g = d3.rollup(this.periodRows, rs => d3.sum(rs, r => r[6]), r => r[3], r => r[2]);
      return new Map([...g].map(([c, m]) => [c, [...m].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => this.items[i].name)]));
    },
  },

  watch: {
    monthly() { this.drawTrend(); },
    topItems() { this.drawItems(); },
  },

  async mounted() {
    const data = await (await fetch("data.json")).json();
    try {
      const res = await fetch("items/manifest.json");
      if (res.ok) this.images = await res.json();
    } catch (e) {
      // нет картинок - будут иконки
    }
    Object.assign(this, data);
    this.ready = true;
    await nextTick();
    this.drawTrend(); this.drawItems();
    new ResizeObserver(() => { this.drawTrend(); this.drawItems(); }).observe(this.$refs.trend);
  },

  methods: {
    // форматирование
    fmtInt: v => nf.format(Math.round(v)),
    fmtRub: v => nf.format(Math.round(v)) + " ₽",
    fmtPct: v => (v * 100).toFixed(1).replace(".", ",") + "%",
    fmtMonthLong(k) { const [y, m] = k.split("-"); return `${MONTHS_LONG[m - 1]} ${y}`; },
    fmtMonthShort(k) { const [y, m] = k.split("-"); return `${MONTHS_SHORT[m - 1]} ${y}`; },
    fmtDay(s) { const [y, m, d] = s.split("-"); return `${d}.${m}.${y}`; },
    fmtDelta(k, base) {
      const diff = k.cur - base;
      const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "•";
      if (k.unit === "pp") return `${arrow} ${Math.abs(diff * 100).toFixed(1).replace(".", ",")} п.п.`;
      if (k.unit === "pct") return base ? `${arrow} ${Math.abs(diff / base * 100).toFixed(0)}%` : "—";
      return `${arrow} ${nf.format(Math.abs(diff))}`;
    },
    deltaClass: () => "d",
    catIcon: c => CAT_ICON[c] || "🛒",
    imgSrc(name) { return this.images[name] ? "items/" + this.images[name] : null; },
    toggleCat(i) {
      const s = new Set(this.selected);
      s.has(i) ? s.delete(i) : s.add(i);
      this.selected = s.size === this.cats.length ? new Set() : s;
    },

    // тултип
    showTip(ev, kind, d) {
      this.tip = { show: true, kind, d, x: 0, y: 0 };
      this.moveTip(ev);
      if (kind === "item") nextTick(() => { this.drawPrice(d.idx); this.moveTip(ev); });
    },
    moveTip(ev) {
      const el = this.$refs.tip, w = el.offsetWidth || 280, h = el.offsetHeight || 200;
      let x = ev.clientX + 16, y = ev.clientY + 16;
      if (x + w > window.innerWidth - 8) x = ev.clientX - w - 16;
      if (y + h > window.innerHeight - 8) y = Math.max(8, window.innerHeight - h - 8);
      this.tip.x = x; this.tip.y = y;
    },
    hideTip() { this.tip.show = false; },

    // динамика по месяцам (3 графика друг под другом)
    drawTrend() {
      const el = this.$refs.trend; if (!el) return;
      const W = el.clientWidth, panelH = 120, gap = 34, top = 18;
      const m = { l: 64, r: 12, b: 26 };
      const H = top + 3 * panelH + 2 * gap + m.b;
      const data = this.monthly;
      d3.select(el).selectAll("*").remove();
      const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
      const x = d3.scaleBand(data.map(d => d.m), [m.l, W - m.r]).padding(0.22);
      const panels = [
        { key: "orders", title: "Заказов", fmt: d3.format(",.0f") },
        { key: "spend", title: "Траты, ₽", fmt: v => v ? nf.format(v / 1000) + "k" : "0" },
        { key: "disc", title: "Средняя скидка", fmt: d3.format(".0%") },
      ];
      const hover = svg.append("g");
      panels.forEach((p, i) => {
        const y0 = top + i * (panelH + gap);
        const max = d3.max(data, d => d[p.key]) || 1;
        const y = d3.scaleLinear([0, max], [y0 + panelH, y0]).nice();
        const g = svg.append("g");
        g.append("text").attr("class", "panel-title").attr("x", m.l).attr("y", y0 - 6).text(p.title);
        g.append("g").attr("class", "gridline").selectAll("line").data(y.ticks(3)).join("line")
          .attr("x1", m.l).attr("x2", W - m.r).attr("y1", y).attr("y2", y);
        g.append("g").attr("class", "axis").attr("transform", `translate(${m.l},0)`)
          .call(d3.axisLeft(y).ticks(3).tickFormat(p.fmt).tickSize(0).tickPadding(8)).call(a => a.select(".domain").remove());
        if (p.key === "disc") {
          const cx = d => x(d.m) + x.bandwidth() / 2;
          g.append("path").attr("class", "disc-area").datum(data)
            .attr("d", d3.area().x(cx).y0(y(0)).y1(d => y(d.disc)));
          g.append("path").attr("class", "disc-line").datum(data).attr("d", d3.line().x(cx).y(d => y(d.disc)));
          g.selectAll(".dot").data(data).join("circle").attr("class", "dot").attr("r", 3.5)
            .attr("cx", cx).attr("cy", d => y(d.disc));
        } else {
          const r = Math.min(4, x.bandwidth() / 2);
          g.selectAll("path.bar").data(data).join("path")
            .attr("class", (d, j) => "bar" + (j === data.length - 1 ? " last" : ""))
            .attr("d", d => {
              const x0 = x(d.m), w = x.bandwidth(), yt = y(d[p.key]), yb = y(0), rr = Math.min(r, yb - yt);
              return `M${x0},${yb}V${yt + rr}Q${x0},${yt} ${x0 + rr},${yt}H${x0 + w - rr}Q${x0 + w},${yt} ${x0 + w},${yt + rr}V${yb}Z`;
            });
        }
        g.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(0)).attr("y2", y(0)).attr("stroke", "var(--line)");
      });
      const every = W < 700 ? 3 : 1;
      svg.append("g").attr("class", "axis").attr("transform", `translate(0,${H - m.b})`)
        .call(d3.axisBottom(x).tickSize(0).tickPadding(8)
          .tickFormat((k, i) => i % every ? "" : (k.endsWith("-01") || i === 0 ? this.fmtMonthShort(k) : MONTHS_SHORT[+k.slice(5) - 1])))
        .call(a => a.select(".domain").remove());
      // прозрачные прямоугольники для hover
      const step = x.step();
      svg.append("g").selectAll("rect").data(data).join("rect")
        .attr("x", d => x(d.m) - (step - x.bandwidth()) / 2).attr("width", step)
        .attr("y", 0).attr("height", H - m.b).attr("fill", "transparent")
        .on("mouseenter", (ev, d) => {
          hover.selectAll("*").remove();
          hover.append("rect").attr("class", "col-hover").attr("x", x(d.m) - (step - x.bandwidth()) / 2)
            .attr("width", step).attr("y", top - 4).attr("height", H - m.b - top + 4).attr("rx", 4);
          this.showTip(ev, "month", d);
        })
        .on("mousemove", ev => this.moveTip(ev))
        .on("mouseleave", () => { hover.selectAll("*").remove(); this.hideTip(); });
    },

    // топ товаров
    drawItems() {
      const el = this.$refs.items; if (!el) return;
      const data = this.topItems, rowH = 52, W = el.clientWidth;
      const labelW = Math.min(240, W * 0.42), imgS = 42, valW = 74;
      const H = data.length * rowH;
      d3.select(el).selectAll("*").remove();
      const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
      const key = this.metric;
      const x = d3.scaleLinear([0, d3.max(data, d => d[key]) || 1], [0, W - labelW - imgS - 12 - valW]);
      const fmt = key === "qty" ? v => nf.format(v) + " шт." : this.fmtRub;
      const sec = key === "qty" ? d => this.fmtRub(d.spend) : d => nf.format(d.qty) + " шт.";
      const ellipsis = (s, px) => { const n = Math.floor(px / 6.6); return s.length > n ? s.slice(0, n - 1) + "…" : s; };

      const row = svg.selectAll("g").data(data, d => d.idx).join("g").attr("class", "item-row")
        .attr("transform", (d, i) => `translate(0,${i * rowH})`);
      row.append("rect").attr("class", "item-bg").attr("width", W).attr("height", rowH).attr("rx", 6);
      row.append("text").attr("class", "item-name").attr("x", labelW - 8).attr("y", rowH / 2 + 4)
        .attr("text-anchor", "end").text(d => ellipsis(d.name, labelW - 12)).append("title").text(d => d.name);
      // картинка товара, если нет - иконка категории
      const ix = labelW, iy = (rowH - imgS) / 2;
      row.each((d, i, nodes) => {
        const g = d3.select(nodes[i]), src = this.imgSrc(d.name);
        if (src) {
          const clip = `clip-${d.idx}`;
          g.append("clipPath").attr("id", clip).append("rect").attr("x", ix).attr("y", iy).attr("width", imgS).attr("height", imgS).attr("rx", 10);
          g.append("rect").attr("class", "item-img-bg").attr("x", ix).attr("y", iy).attr("width", imgS).attr("height", imgS).attr("rx", 10);
          g.append("image").attr("href", src).attr("x", ix + 3).attr("y", iy + 3).attr("width", imgS - 6).attr("height", imgS - 6)
            .attr("clip-path", `url(#${clip})`).attr("preserveAspectRatio", "xMidYMid meet");
        } else {
          g.append("rect").attr("class", "item-ico-bg").attr("x", ix).attr("y", iy).attr("width", imgS).attr("height", imgS).attr("rx", 7);
          g.append("text").attr("class", "item-ico").attr("x", ix + imgS / 2).attr("y", rowH / 2 + 6)
            .attr("text-anchor", "middle").text(this.catIcon(this.cats[d.cat]));
        }
      });
      const bx = labelW + imgS + 10;
      row.append("rect").attr("class", "bar").attr("x", bx).attr("y", rowH / 2 - 8).attr("height", 16).attr("rx", 4)
        .attr("width", d => Math.max(2, x(d[key])));
      row.append("text").attr("class", "item-val").attr("x", d => bx + x(d[key]) + 6).attr("y", rowH / 2 - 1).text(d => fmt(d[key]));
      row.append("text").attr("class", "item-sec").attr("x", d => bx + x(d[key]) + 6).attr("y", rowH / 2 + 12).text(sec);
      row.on("mouseenter", (ev, d) => this.showTip(ev, "item", this.itemDetail(d)))
        .on("mousemove", ev => this.moveTip(ev))
        .on("mouseleave", () => this.hideTip());
    },

    itemDetail(d) {
      const rs = this.rows.filter(r => r[2] === d.idx);
      const last = rs[rs.length - 1];
      return { ...d, lastPrice: last[5], lastDate: last[1] };
    },

    // график цены для тултипа
    drawPrice(idx) {
      const el = this.$refs.tipChart; if (!el) return;
      const rs = this.rows.filter(r => r[2] === idx);
      const pts = d3.rollups(rs, v => ({
        full: d3.sum(v, r => r[4] * r[6]) / d3.sum(v, r => r[6]),
        disc: d3.sum(v, r => r[5] * r[6]) / d3.sum(v, r => r[6]),
      }), r => monthKey(r[1])).map(([m, p]) => ({ date: new Date(m + "-15"), ...p }));
      const W = 256, H = 96, m = { l: 34, r: 6, t: 6, b: 16 };
      d3.select(el).selectAll("*").remove();
      const svg = d3.select(el).append("svg").attr("width", W).attr("height", H);
      const x = d3.scaleTime(d3.extent(pts, p => p.date), [m.l, W - m.r]);
      if (pts.length === 1) x.domain([d3.timeMonth.offset(pts[0].date, -1), d3.timeMonth.offset(pts[0].date, 1)]);
      const y = d3.scaleLinear([d3.min(pts, p => p.disc) * 0.9, d3.max(pts, p => p.full) * 1.05], [H - m.b, m.t]).nice();
      svg.append("g").attr("transform", `translate(${m.l},0)`)
        .call(d3.axisLeft(y).ticks(3).tickSize(0).tickPadding(4).tickFormat(v => nf.format(v) + " ₽"))
        .call(a => a.select(".domain").remove());
      svg.append("g").attr("transform", `translate(0,${H - m.b})`)
        .call(d3.axisBottom(x).ticks(4).tickSize(0).tickPadding(4).tickFormat(d3.timeFormat("%Y")))
        .call(a => a.select(".domain").remove());
      svg.append("path").attr("class", "p-full").datum(pts).attr("d", d3.line().x(p => x(p.date)).y(p => y(p.full)));
      svg.append("path").attr("class", "p-disc").datum(pts).attr("d", d3.line().x(p => x(p.date)).y(p => y(p.disc)));
      svg.selectAll("circle").data(pts).join("circle").attr("r", pts.length > 30 ? 1.5 : 2.5)
        .attr("cx", p => x(p.date)).attr("cy", p => y(p.disc)).attr("fill", "var(--accent)");
    },
  },
}).mount("#app");

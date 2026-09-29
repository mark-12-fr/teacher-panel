"use client";
// Chart.js with ONLY the pieces this app uses. `registerables` pulls in every
// controller, scale and plugin (radar, polar, bubble, time, logarithmic…) — code
// the dashboard never runs but still downloads and parses on every open. Import
// `Chart` from here instead of "chart.js" so the shared registration below
// applies and the unused parts tree-shake out of the bundle.
//
// In use: line (Class Performance), doughnut (Sections at a Glance, grade
// distribution), bar (WW/PT/Exam); category + linear scales; tooltip (incl. the
// dashboard's custom external tooltip), legend (Performance doughnut), and the
// Filler plugin for the line chart's gradient area.
import {
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(
  ArcElement,
  BarController,
  BarElement,
  CategoryScale,
  DoughnutController,
  Filler,
  Legend,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
);

export { Chart };

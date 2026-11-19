// make custome pink and green colour pallete :)
const PALETTE = {
  deepCrimson: '#8F1235',
  darkPink: '#B51F4B',
  rosePink: '#D95778',
  palePink: '#E995A5',
  oliveGreen: '#536039',
  darkGreen: '#263C1D',
  mutedNeutral: '#E8E3E1'
};

const INCOME_ORDER = [
  'Low income',
  'Lower middle income',
  'Upper middle income',
  'High income'
];

const INCOME_COLORS = {
  'Low income': PALETTE.deepCrimson,       // #8F1235
  'Lower middle income': PALETTE.darkPink, // #B51F4B
  'Upper middle income': PALETTE.oliveGreen, // #536039
  'High income': PALETTE.darkGreen         // #263C1D
};

const LENDING_CATEGORIES = ['IDA', 'IBRD', 'Blend', 'Not classified'];
const LENDING_COLORS = [
  PALETTE.darkPink,    // IDA (#B51F4B)
  PALETTE.darkGreen,   // IBRD (#263C1D)
  PALETTE.rosePink,    // Blend (#D95778)
  PALETTE.palePink     // Not classified (#E995A5)
];

const WORLD_GEOJSON_URL = 'https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json';

Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
Chart.defaults.color = PALETTE.darkGreen;

let allEconomies = [];
let economyByCode = {};
let worldGeoJsonData = null;
let geoJsonLayer = null;

let incomeBarChart = null;
let lendingDoughnutChart = null;
let regionStackedChart = null;

// initialize Leaflet Map 
const southWest = L.latLng(-85, -180);
const northEast = L.latLng(85, 180);
const worldBounds = L.latLngBounds(southWest, northEast);

const map = L.map('worldMap', {
  center: [20, 10],
  zoom: 2,
  minZoom: 2,
  maxBounds: worldBounds,
  maxBoundsViscosity: 1.0,
  worldCopyJump: false
});

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  noWrap: true,
  bounds: worldBounds,
  attribution: '© OpenStreetMap contributors'
}).addTo(map);

// 3. Load WDI CSV and World GeoJSON 
async function initDashboard() {
  try {
    const csvResponse = await fetch('data/CLASS_2026_10_08.csv');
    if (!csvResponse.ok) throw new Error(`HTTP ${csvResponse.status} loading data/CLASS_2026_10_08.csv`);
    const csvText = await csvResponse.text();

    const firstLine = csvText.split(/\r?\n/)[0] || '';
    const delimiter = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';

    const parsed = Papa.parse(csvText, {
      header: true,
      delimiter: delimiter,
      skipEmptyLines: true,
      transformHeader: (header) => header.replace(/^\uFEFF/, '').trim()
    });

    allEconomies = parsed.data
      .filter(row => row.Region && row.Region.trim() !== '' && row['Income group'] && row['Income group'].trim() !== '')
      .map(row => ({
        economy: (row.Economy || '').trim(),
        code: (row.Code || '').trim().toUpperCase(),
        region: row.Region.trim(),
        incomeGroup: row['Income group'].trim(),
        lendingCategory: (row['Lending category'] && row['Lending category'].trim() !== '')
          ? row['Lending category'].trim()
          : 'Not classified'
      }));

    economyByCode = {};
    allEconomies.forEach(item => {
      economyByCode[item.code] = item;
    });

    populateFilters();
    updateDashboard();

    const geoResponse = await fetch(WORLD_GEOJSON_URL);
    if (!geoResponse.ok) throw new Error(`HTTP ${geoResponse.status} loading World GeoJSON`);
    worldGeoJsonData = await geoResponse.json();

    updateDashboard();
  } catch (err) {
    console.error('Dashboard initialization error:', err);
  }
}

function populateFilters() {
  const regionSelect = document.getElementById('regionFilter');
  const lendingSelect = document.getElementById('lendingFilter');

  const uniqueRegions = [...new Set(allEconomies.map(d => d.region))].sort();
  uniqueRegions.forEach(region => {
    const opt = document.createElement('option');
    opt.value = region;
    opt.textContent = region;
    regionSelect.appendChild(opt);
  });

  LENDING_CATEGORIES.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    lendingSelect.appendChild(opt);
  });

  regionSelect.addEventListener('change', updateDashboard);
  lendingSelect.addEventListener('change', updateDashboard);
  document.getElementById('resetFiltersBtn').addEventListener('click', () => {
    regionSelect.value = 'ALL';
    lendingSelect.value = 'ALL';
    updateDashboard();
  });
}

function updateDashboard() {
  const selectedRegion = document.getElementById('regionFilter').value;
  const selectedLending = document.getElementById('lendingFilter').value;

  const filtered = allEconomies.filter(item => {
    const matchRegion = (selectedRegion === 'ALL') || (item.region === selectedRegion);
    const matchLending = (selectedLending === 'ALL') || (item.lendingCategory === selectedLending);
    return matchRegion && matchLending;
  });

  const filteredCodes = new Set(filtered.map(d => d.code));

  // Update Summary Indicators
  const total = filtered.length;
  const highIncomeCount = filtered.filter(d => d.incomeGroup === 'High income').length;
  const highIncomeShare = total > 0 ? ((highIncomeCount / total) * 100).toFixed(1) : '0.0';

  const incomeCounts = INCOME_ORDER.map(group => filtered.filter(d => d.incomeGroup === group).length);
  const maxCount = Math.max(...incomeCounts);
  const dominant = total > 0 ? INCOME_ORDER[incomeCounts.indexOf(maxCount)] : 'None';

  document.getElementById('totalEconomies').textContent = total;
  document.getElementById('highIncomePct').textContent = `${highIncomeShare}%`;
  document.getElementById('dominantGroup').textContent = `${dominant} (${maxCount})`;

  renderWorldMap(filteredCodes, selectedRegion === 'ALL' && selectedLending === 'ALL');
  renderIncomeBarChart(incomeCounts);
  renderLendingDoughnutChart(filtered);
  renderRegionStackedChart(filtered);
}

function renderWorldMap(filteredCodes, isGlobalView) {
  if (!worldGeoJsonData) return;

  if (geoJsonLayer) {
    map.removeLayer(geoJsonLayer);
  }

  const highlightedBounds = L.latLngBounds();
  let hasHighlightedBounds = false;

  geoJsonLayer = L.geoJSON(worldGeoJsonData, {
    style: (feature) => {
      const isoCode = (feature.id || '').toUpperCase();
      const record = economyByCode[isoCode];
      const isSelected = record && filteredCodes.has(isoCode);

      if (isSelected) {
        return {
          fillColor: INCOME_COLORS[record.incomeGroup] || PALETTE.darkGreen,
          weight: isGlobalView ? 0.9 : 1.5,
          opacity: 1,
          color: isGlobalView ? '#FCF9FA' : PALETTE.deepCrimson,
          fillOpacity: 0.88
        };
      }

      return {
        fillColor: PALETTE.mutedNeutral,
        weight: 0.5,
        opacity: 0.6,
        color: '#C9BFC2',
        fillOpacity: 0.3
      };
    },
    onEachFeature: (feature, layer) => {
      const isoCode = (feature.id || '').toUpperCase();
      const record = economyByCode[isoCode];
      const isSelected = record && filteredCodes.has(isoCode);

      if (isSelected && layer.getBounds) {
        highlightedBounds.extend(layer.getBounds());
        hasHighlightedBounds = true;
      }

      if (record) {
        layer.bindPopup(`
          <div class="p-1" style="color: #263C1D;">
            <h6 class="mb-1 fw-bold" style="color: #8F1235;">${record.economy} (${record.code})</h6>
            <div class="small"><strong>Region:</strong> ${record.region}</div>
            <div class="small"><strong>Income Group:</strong> ${record.incomeGroup}</div>
            <div class="small"><strong>Lending:</strong> ${record.lendingCategory}</div>
          </div>
        `);
      } else {
        const name = (feature.properties && feature.properties.name) || isoCode;
        layer.bindPopup(`<div class="small fw-semibold" style="color: #263C1D;">${name} (Not in WDI dataset)</div>`);
      }

      layer.on({
        mouseover: (e) => {
          e.target.setStyle({ weight: 2, color: PALETTE.deepCrimson });
          e.target.bringToFront();
        },
        mouseout: (e) => {
          geoJsonLayer.resetStyle(e.target);
        }
      });
    }
  }).addTo(map);

  if (isGlobalView || !hasHighlightedBounds) {
    map.setView([20, 10], 2);
  } else {
    map.fitBounds(highlightedBounds, { padding: [20, 20], maxZoom: 5 });
  }
}

const floralGridColor = 'rgba(143, 18, 53, 0.08)';

function renderIncomeBarChart(counts) {
  const ctx = document.getElementById('incomeBarChart').getContext('2d');
  if (incomeBarChart) incomeBarChart.destroy();

  incomeBarChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: INCOME_ORDER,
      datasets: [{
        label: 'Number of Economies',
        data: counts,
        backgroundColor: INCOME_ORDER.map(g => INCOME_COLORS[g]),
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false } },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: floralGridColor }
        }
      }
    }
  });
}

function renderLendingDoughnutChart(data) {
  const ctx = document.getElementById('lendingDoughnutChart').getContext('2d');
  if (lendingDoughnutChart) lendingDoughnutChart.destroy();

  const counts = LENDING_CATEGORIES.map(cat => data.filter(d => d.lendingCategory === cat).length);

  lendingDoughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: LENDING_CATEGORIES,
      datasets: [{
        data: counts,
        backgroundColor: LENDING_COLORS,
        borderColor: '#FFFFFF',
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: {
          position: 'right',
          labels: { usePointStyle: true, padding: 16 }
        }
      }
    }
  });
}

function renderRegionStackedChart(data) {
  const ctx = document.getElementById('regionStackedChart').getContext('2d');
  if (regionStackedChart) regionStackedChart.destroy();

  const regions = [...new Set(allEconomies.map(d => d.region))].sort();

  const datasets = INCOME_ORDER.map(group => ({
    label: group,
    backgroundColor: INCOME_COLORS[group],
    borderRadius: 3,
    data: regions.map(reg => data.filter(d => d.region === reg && d.incomeGroup === group).length)
  }));

  regionStackedChart = new Chart(ctx, {
    type: 'bar',
    data: { labels: regions, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { usePointStyle: true, padding: 16 } }
      },
      scales: {
        x: { stacked: true, grid: { display: false } },
        y: {
          stacked: true,
          beginAtZero: true,
          ticks: { precision: 0 },
          grid: { color: floralGridColor }
        }
      }
    }
  });
}

// Start application
initDashboard();
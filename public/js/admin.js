// POTER EDUGAMES - Admin Dashboard Logic

let trendChartInstance = null;
let osChartInstance = null;

let currentAccessPage = 1;
let currentDownloadPage = 1;
let currentInstallPage = 1;
let currentAuditPage = 1;

document.addEventListener('DOMContentLoaded', async () => {
  // 1. Verify Authentication
  try {
    const res = await fetch('/api/auth/me');
    const data = await res.json();
    if (!data.authenticated) {
      window.location.href = '/admin/login.html';
      return;
    }
    const usernameEl = document.getElementById('adminUsername');
    if (usernameEl) usernameEl.textContent = data.user?.username || 'admin';
  } catch (err) {
    window.location.href = '/admin/login.html';
    return;
  }

  // 2. Setup Clock
  function updateClock() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('id-ID', { hour12: false }) + ' WIB';
    const clockEl = document.getElementById('liveClock');
    if (clockEl) clockEl.textContent = timeStr;
  }
  setInterval(updateClock, 1000);
  updateClock();

  // 3. Setup Logout
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST' });
        window.location.href = '/admin/login.html';
      } catch (err) {
        window.location.href = '/admin/login.html';
      }
    });
  }

  // 4. Setup single dashboard view filter
  const viewFilter = document.getElementById('dashboardViewFilter');
  const tabContents = document.querySelectorAll('.tab-content');

  const viewConfig = {
    'tab-overview': {
      title: 'Ringkasan & Grafik',
      description: 'Ikhtisar trafik publik dan unduhan APK yang telah selesai dikirim.',
      load: () => loadDashboardStats()
    },
    'tab-access-logs': {
      title: 'Riwayat Akses Web',
      description: 'Kunjungan ke portal publik, terpisah dari unduhan dan aktivitas admin.',
      load: () => loadAccessLogs(1)
    },
    'tab-download-logs': {
      title: 'Unduhan APK Terverifikasi',
      description: 'Hanya transfer APK yang selesai tanpa error atau pembatalan.',
      load: () => loadDownloadLogs(1)
    },
    'tab-install-logs': {
      title: 'Telemetri Pemasangan',
      description: 'Konfirmasi aplikasi pertama kali dibuka pada perangkat pengguna.',
      load: () => loadInstallLogs(1)
    },
    'tab-admin-audit': {
      title: 'Aktivitas Admin',
      description: 'Login, logout, navigasi, ekspor, dan perubahan yang dilakukan admin.',
      load: () => loadAdminAuditLogs(1)
    },
    'tab-versions': {
      title: 'Kelola Versi Game',
      description: 'Publikasikan versi APK dan tentukan rilis utama.',
      load: () => loadVersionList()
    },
    'tab-docs': {
      title: 'Panduan Telemetri',
      description: 'Petunjuk integrasi konfirmasi pemasangan dari aplikasi Android.'
    }
  };

  async function activateDashboardView(targetId) {
    const config = viewConfig[targetId] || viewConfig['tab-overview'];
    tabContents.forEach(content => {
      content.style.display = content.id === targetId ? 'block' : 'none';
    });

    document.getElementById('activeViewTitle').textContent = config.title;
    document.getElementById('activeViewDescription').textContent = config.description;
    if (viewFilter) viewFilter.value = targetId;

    try {
      await fetch('/api/dashboard/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ section: config.title })
      });
    } catch (err) {
      console.warn('Aktivitas navigasi tidak dapat dicatat:', err);
    }

    config.load?.();
  }

  viewFilter?.addEventListener('change', () => activateDashboardView(viewFilter.value));

  // 5. Setup Filters & Pagination Events
  setupAccessFilters();
  setupDownloadFilters();
  setupAuditFilters();
  setupVersionForm();

  // Initial Load
  activateDashboardView('tab-overview');
});

// Load KPI Stats & Charts
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const json = await res.json();
    if (!json.success) return;

    const { summary, dailyVisits, dailyDownloads, osDistribution, recentAccess, recentDownloads } = json.data;

    // Update KPI values
    document.getElementById('statTotalVisits').textContent = summary.totalVisits.toLocaleString('id-ID');
    document.getElementById('statUniqueVisitors').textContent = summary.uniqueVisitors.toLocaleString('id-ID');
    document.getElementById('statTotalDownloads').textContent = summary.totalDownloads.toLocaleString('id-ID');
    document.getElementById('statTotalInstalls').textContent = summary.totalInstalls.toLocaleString('id-ID');
    document.getElementById('statTodayVisits').textContent = `+${summary.todayVisits}`;
    document.getElementById('statDownloadRate').textContent = summary.downloadRate;
    document.getElementById('statInstallRate').textContent = summary.installRate;

    // Render Recent Combined Feed
    renderRecentFeed(recentAccess, recentDownloads);

    // Render Charts
    renderTrendChart(dailyVisits, dailyDownloads);
    renderOsChart(osDistribution);

  } catch (err) {
    console.error('Gagal memuat ringkasan dashboard:', err);
  }
}

// Render Recent Feed Table
function renderRecentFeed(accessLogs = [], downloadLogs = []) {
  const tbody = document.getElementById('recentFeedBody');
  if (!tbody) return;

  const combined = [
    ...accessLogs.map(a => ({ ...a, type: 'Akses Web' })),
    ...downloadLogs.map(d => ({ ...d, type: 'Unduh APK', path: d.version }))
  ].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 8);

  if (combined.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Belum ada aktivitas tercatat.</td></tr>';
    return;
  }

  tbody.innerHTML = combined.map(item => {
    const isDownload = item.type === 'Unduh APK';
    const badgeType = isDownload 
      ? '<span style="background-color: #DBEAFE; color: #1D4ED8; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">Unduh APK</span>'
      : '<span style="background-color: #F1F5F9; color: #475569; padding: 3px 8px; border-radius: 4px; font-weight: 700; font-size: 0.75rem;">Kunjungan</span>';

    const osBadge = getOsBadgeClass(item.os);

    return `
      <tr>
        <td style="color: #64748B; font-size: 0.82rem;">${formatTime(item.timestamp)}</td>
        <td>${badgeType}</td>
        <td><code>${item.ip}</code></td>
        <td><span class="badge-device ${osBadge}">${item.os}</span></td>
        <td>${item.browser}</td>
        <td><b>${item.path || '-'}</b></td>
      </tr>
    `;
  }).join('');
}

// Render Trend Chart (Visits vs Downloads)
function renderTrendChart(visits = [], downloads = []) {
  const ctx = document.getElementById('trendChart');
  if (!ctx) return;

  // Prepare dates map
  const dateMap = {};
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const label = d.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
    dateMap[dateKey] = { label, visits: 0, downloads: 0 };
  }

  visits.forEach(v => {
    if (dateMap[v.date]) dateMap[v.date].visits = v.visits;
  });

  downloads.forEach(d => {
    if (dateMap[d.date]) dateMap[d.date].downloads = d.downloads;
  });

  const labels = Object.values(dateMap).map(item => item.label);
  const visitCounts = Object.values(dateMap).map(item => item.visits);
  const downloadCounts = Object.values(dateMap).map(item => item.downloads);

  if (trendChartInstance) {
    trendChartInstance.destroy();
  }

  trendChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Kunjungan Web',
          data: visitCounts,
          borderColor: '#1D4ED8',
          backgroundColor: 'rgba(29, 78, 216, 0.08)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: 4
        },
        {
          label: 'Unduhan APK',
          data: downloadCounts,
          borderColor: '#059669',
          backgroundColor: 'rgba(5, 150, 105, 0.08)',
          fill: true,
          tension: 0.3,
          borderWidth: 2.5,
          pointRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top', labels: { boxWidth: 12, font: { weight: 'bold' } } }
      },
      scales: {
        y: { beginAtZero: true, ticks: { precision: 0 } }
      }
    }
  });
}

// Render OS Doughnut Chart
function renderOsChart(osData = []) {
  const ctx = document.getElementById('osChart');
  if (!ctx) return;

  const labels = osData.map(o => o.os);
  const counts = osData.map(o => o.count);

  if (osChartInstance) {
    osChartInstance.destroy();
  }

  osChartInstance = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.length ? labels : ['Belum ada data'],
      datasets: [{
        data: counts.length ? counts : [1],
        backgroundColor: ['#1D4ED8', '#059669', '#D97706', '#7C3AED', '#64748B'],
        borderWidth: 2,
        borderColor: '#FFFFFF'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right', labels: { boxWidth: 12 } }
      }
    }
  });
}

// -------------------------------------------------------------
// TAB 2: Access Logs Handling
// -------------------------------------------------------------
function setupAccessFilters() {
  const searchInput = document.getElementById('accessSearchInput');
  const osFilter = document.getElementById('accessOsFilter');
  const prevBtn = document.getElementById('btnAccessPrev');
  const nextBtn = document.getElementById('btnAccessNext');

  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentAccessPage = 1;
        loadAccessLogs(1);
      }, 350);
    });
  }

  if (osFilter) {
    osFilter.addEventListener('change', () => {
      currentAccessPage = 1;
      loadAccessLogs(1);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentAccessPage > 1) {
        currentAccessPage--;
        loadAccessLogs(currentAccessPage);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentAccessPage++;
      loadAccessLogs(currentAccessPage);
    });
  }
}

async function loadAccessLogs(page = 1) {
  const tbody = document.getElementById('accessLogsBody');
  const paginationInfo = document.getElementById('accessPaginationInfo');
  const prevBtn = document.getElementById('btnAccessPrev');
  const nextBtn = document.getElementById('btnAccessNext');
  const search = document.getElementById('accessSearchInput')?.value || '';
  const os = document.getElementById('accessOsFilter')?.value || '';

  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Memuat data akses...</td></tr>';

  try {
    const query = new URLSearchParams({ page, limit: 15, search, os });
    const res = await fetch(`/api/dashboard/access-logs?${query.toString()}`);
    const data = await res.json();

    if (!data.success || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #64748B;">Tidak ada log akses yang cocok.</td></tr>';
      paginationInfo.textContent = '0 dari 0 data';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    tbody.innerHTML = data.logs.map(log => {
      const osBadge = getOsBadgeClass(log.os);
      return `
        <tr>
          <td style="color: #64748B; font-size: 0.82rem;">${formatTime(log.timestamp)}</td>
          <td><code>${log.ip}</code></td>
          <td><span class="badge-device ${osBadge}">${log.os} (${log.device_type})</span></td>
          <td>${log.browser}</td>
          <td><b>${log.path}</b></td>
          <td style="color: #64748B; font-size: 0.8rem; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${log.referrer}">
            ${log.referrer}
          </td>
        </tr>
      `;
    }).join('');

    paginationInfo.textContent = `Halaman ${data.page} dari ${data.totalPages} (Total ${data.total} catatan)`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #DC2626; padding: 20px;">Gagal memuat log akses.</td></tr>';
  }
}

// -------------------------------------------------------------
// TAB 3: Download Logs Handling
// -------------------------------------------------------------
function setupDownloadFilters() {
  const searchInput = document.getElementById('downloadSearchInput');
  const versionFilter = document.getElementById('downloadVersionFilter');
  const prevBtn = document.getElementById('btnDownloadPrev');
  const nextBtn = document.getElementById('btnDownloadNext');

  let debounceTimer;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        currentDownloadPage = 1;
        loadDownloadLogs(1);
      }, 350);
    });
  }

  if (versionFilter) {
    versionFilter.addEventListener('change', () => {
      currentDownloadPage = 1;
      loadDownloadLogs(1);
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (currentDownloadPage > 1) {
        currentDownloadPage--;
        loadDownloadLogs(currentDownloadPage);
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      currentDownloadPage++;
      loadDownloadLogs(currentDownloadPage);
    });
  }
}

async function loadDownloadLogs(page = 1) {
  const tbody = document.getElementById('downloadLogsBody');
  const paginationInfo = document.getElementById('downloadPaginationInfo');
  const prevBtn = document.getElementById('btnDownloadPrev');
  const nextBtn = document.getElementById('btnDownloadNext');
  const search = document.getElementById('downloadSearchInput')?.value || '';
  const version = document.getElementById('downloadVersionFilter')?.value || '';

  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Memuat data unduhan...</td></tr>';

  try {
    const query = new URLSearchParams({ page, limit: 15, search, version });
    const res = await fetch(`/api/dashboard/download-logs?${query.toString()}`);
    const data = await res.json();

    if (!data.success || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 24px; color: #64748B;">Tidak ada catatan unduhan APK yang cocok.</td></tr>';
      paginationInfo.textContent = '0 dari 0 data';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    tbody.innerHTML = data.logs.map(log => {
      const osBadge = getOsBadgeClass(log.os);
      return `
        <tr>
          <td style="color: #64748B; font-size: 0.82rem;">${formatTime(log.timestamp)}</td>
          <td><b style="color: #1D4ED8;">${log.version}</b></td>
          <td><code>${log.ip}</code></td>
          <td><span class="badge-device ${osBadge}">${log.os} (${log.device_type})</span></td>
          <td>${log.browser}</td>
          <td><span class="badge-status-ok" title="${formatBytes(log.bytes_sent)} terkirim">Transfer Selesai</span></td>
        </tr>
      `;
    }).join('');

    paginationInfo.textContent = `Halaman ${data.page} dari ${data.totalPages} (Total ${data.total} catatan)`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #DC2626; padding: 20px;">Gagal memuat log unduhan.</td></tr>';
  }
}

// -------------------------------------------------------------
// TAB 4: Install Telemetry Logs
// -------------------------------------------------------------
async function loadInstallLogs(page = 1) {
  const tbody = document.getElementById('installLogsBody');
  const paginationInfo = document.getElementById('installPaginationInfo');
  const prevBtn = document.getElementById('btnInstallPrev');
  const nextBtn = document.getElementById('btnInstallNext');

  tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 20px;">Memuat telemetri instalasi...</td></tr>';

  try {
    const res = await fetch(`/api/dashboard/install-logs?page=${page}&limit=15`);
    const data = await res.json();

    if (!data.success || data.logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" style="text-align: center; padding: 32px; color: #64748B;">
            Belum ada konfirmasi pembukaan aplikasi (first launch).<br>
            <small>Uji coba dapat dilakukan dengan perintah cURL di tab "Panduan Telemetri".</small>
          </td>
        </tr>
      `;
      paginationInfo.textContent = '0 dari 0 data';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    tbody.innerHTML = data.logs.map(log => {
      return `
        <tr>
          <td style="color: #64748B; font-size: 0.82rem;">${formatTime(log.timestamp)}</td>
          <td><b style="color: #059669;">${log.version}</b></td>
          <td><b>${log.device_model || 'Android Phone'}</b></td>
          <td>${log.os_version || 'Android'}</td>
          <td><code>${log.device_id || '-'}</code></td>
          <td><code>${log.ip}</code></td>
        </tr>
      `;
    }).join('');

    paginationInfo.textContent = `Halaman ${data.page} dari ${data.totalPages} (Total ${data.total} catatan)`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #DC2626; padding: 20px;">Gagal memuat data telemetri.</td></tr>';
  }
}

// -------------------------------------------------------------
// ADMIN AUDIT LOGS
// -------------------------------------------------------------
function setupAuditFilters() {
  const searchInput = document.getElementById('auditSearchInput');
  const categoryFilter = document.getElementById('auditCategoryFilter');
  const statusFilter = document.getElementById('auditStatusFilter');
  const prevBtn = document.getElementById('btnAuditPrev');
  const nextBtn = document.getElementById('btnAuditNext');
  let debounceTimer;

  searchInput?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentAuditPage = 1;
      loadAdminAuditLogs(1);
    }, 350);
  });

  [categoryFilter, statusFilter].forEach(filter => {
    filter?.addEventListener('change', () => {
      currentAuditPage = 1;
      loadAdminAuditLogs(1);
    });
  });

  prevBtn?.addEventListener('click', () => {
    if (currentAuditPage > 1) {
      currentAuditPage--;
      loadAdminAuditLogs(currentAuditPage);
    }
  });

  nextBtn?.addEventListener('click', () => {
    currentAuditPage++;
    loadAdminAuditLogs(currentAuditPage);
  });
}

async function loadAdminAuditLogs(page = 1) {
  const tbody = document.getElementById('auditLogsBody');
  const paginationInfo = document.getElementById('auditPaginationInfo');
  const prevBtn = document.getElementById('btnAuditPrev');
  const nextBtn = document.getElementById('btnAuditNext');
  if (!tbody || !paginationInfo || !prevBtn || !nextBtn) return;

  const search = document.getElementById('auditSearchInput')?.value || '';
  const category = document.getElementById('auditCategoryFilter')?.value || '';
  const status = document.getElementById('auditStatusFilter')?.value || '';
  tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:24px;">Memuat aktivitas admin...</td></tr>';

  try {
    const query = new URLSearchParams({ page, limit: 15, search, category, status });
    const res = await fetch(`/api/dashboard/admin-audit-logs?${query.toString()}`);
    const data = await res.json();

    if (!data.success || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:28px;color:#64748B;">Belum ada aktivitas admin yang cocok.</td></tr>';
      paginationInfo.textContent = '0 dari 0 data';
      prevBtn.disabled = true;
      nextBtn.disabled = true;
      return;
    }

    const categoryLabels = {
      authentication: 'Login & Logout',
      navigation: 'Navigasi',
      version_management: 'Kelola Versi',
      data_export: 'Ekspor Data'
    };
    const actionLabels = {
      LOGIN_SUCCESS: 'Login berhasil',
      LOGIN_FAILED: 'Login gagal',
      LOGOUT: 'Logout',
      VIEW_SECTION: 'Membuka tampilan',
      CREATE_VERSION: 'Tambah versi',
      SET_LATEST_VERSION: 'Ubah versi utama',
      EXPORT_ACCESS_LOGS: 'Ekspor akses',
      EXPORT_VERIFIED_DOWNLOADS: 'Ekspor unduhan',
      EXPORT_ADMIN_AUDIT: 'Ekspor audit admin'
    };

    tbody.innerHTML = data.logs.map(log => {
      const denied = log.status === 'denied';
      return `
        <tr>
          <td style="color:#64748B;font-size:.82rem;white-space:nowrap;">${formatTime(log.timestamp)}</td>
          <td><b>${escapeHtml(log.username)}</b></td>
          <td>${escapeHtml(categoryLabels[log.category] || log.category)}</td>
          <td><span class="audit-action">${escapeHtml(actionLabels[log.action] || log.action)}</span></td>
          <td style="max-width:320px;">${escapeHtml(log.details || '-')}</td>
          <td><code>${escapeHtml(log.ip || '-')}</code></td>
          <td><span class="${denied ? 'badge-status-denied' : 'badge-status-ok'}">${denied ? 'Ditolak' : 'Berhasil'}</span></td>
        </tr>
      `;
    }).join('');

    paginationInfo.textContent = `Halaman ${data.page} dari ${data.totalPages} (Total ${data.total} catatan)`;
    prevBtn.disabled = data.page <= 1;
    nextBtn.disabled = data.page >= data.totalPages;
    currentAuditPage = data.page;
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#DC2626;padding:24px;">Gagal memuat aktivitas admin.</td></tr>';
  }
}

// -------------------------------------------------------------
// VERSION MANAGEMENT
// -------------------------------------------------------------
let editingVersionId = null;
let versionCache = new Map();
let trashVersionCache = new Map();

function setupVersionForm() {
  const form = document.getElementById('addVersionForm');
  if (!form) return;

  document.getElementById('btnCancelVersionEdit')?.addEventListener('click', resetVersionForm);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('btnSaveVersion');
    btn.disabled = true;
    btn.textContent = editingVersionId ? 'Menyimpan Perubahan...' : 'Menyimpan...';

    const versionCode = document.getElementById('newVersionCode').value.trim();
    const fileSize = document.getElementById('newFileSize').value.trim();
    const downloadUrl = document.getElementById('newDownloadUrl').value.trim();
    const releaseDate = document.getElementById('newReleaseDate').value.trim();
    const minAndroid = document.getElementById('newMinAndroid').value.trim();
    const changelog = document.getElementById('newChangelog').value.trim();
    const isLatest = document.getElementById('newIsLatest').checked;
    const downloadEnabled = document.getElementById('newDownloadEnabled').checked;

    try {
      const res = await fetch(editingVersionId ? `/api/versions/${editingVersionId}` : '/api/versions', {
        method: editingVersionId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version_code: versionCode,
          file_size: fileSize,
          download_url: downloadUrl,
          release_date: releaseDate,
          min_android: minAndroid,
          changelog,
          is_latest: isLatest,
          download_enabled: downloadEnabled
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.message || 'Gagal menyimpan versi.');
      alert(data.message);
      resetVersionForm();
      await loadVersionList();
      loadDashboardStats();
    } catch (err) {
      alert(err.message || 'Terjadi kesalahan jaringan.');
    } finally {
      btn.disabled = false;
      btn.textContent = editingVersionId ? 'Simpan Perubahan' : 'Simpan & Publikasikan Versi Baru';
    }
  });
}

function resetVersionForm() {
  const form = document.getElementById('addVersionForm');
  editingVersionId = null;
  form?.reset();
  document.getElementById('versionFormTitle').textContent = 'Tambah Rilis Versi APK Baru';
  document.getElementById('versionFormDescription').textContent = 'Tambahkan versi game edukasi baru yang langsung tampil di portal unduh publik.';
  document.getElementById('btnSaveVersion').textContent = 'Simpan & Publikasikan Versi Baru';
  document.getElementById('btnCancelVersionEdit').hidden = true;
}

function editVersion(versionId) {
  const version = versionCache.get(Number(versionId));
  if (!version) {
    alert('Data versi belum tersedia. Muat ulang daftar lalu coba lagi.');
    return;
  }

  editingVersionId = Number(versionId);
  document.getElementById('newVersionCode').value = version.version_code || '';
  document.getElementById('newFileSize').value = version.file_size || '';
  document.getElementById('newDownloadUrl').value = version.download_url || '';
  document.getElementById('newReleaseDate').value = version.release_date || '';
  document.getElementById('newMinAndroid').value = version.min_android || '';
  document.getElementById('newChangelog').value = Array.isArray(version.changelog)
    ? version.changelog.join('\n')
    : '';
  document.getElementById('newIsLatest').checked = version.is_latest === 1;
  document.getElementById('newDownloadEnabled').checked = version.download_enabled !== 0;
  document.getElementById('versionFormTitle').textContent = `Edit ${version.version_code}`;
  document.getElementById('versionFormDescription').textContent = 'Perbarui informasi rilis. Perubahan akan langsung digunakan oleh portal publik.';
  document.getElementById('btnSaveVersion').textContent = 'Simpan Perubahan';
  document.getElementById('btnCancelVersionEdit').hidden = false;
  document.getElementById('addVersionForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('newVersionCode').focus({ preventScroll: true });
}

async function loadVersionList() {
  const tbody = document.getElementById('versionTableBody');
  const trashBody = document.getElementById('versionTrashTableBody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Memuat versi...</td></tr>';
  if (trashBody) trashBody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;">Memuat sampah...</td></tr>';

  try {
    const [activeRes, trashRes] = await Promise.all([
      fetch('/api/admin/versions?status=active'),
      fetch('/api/admin/versions?status=trash')
    ]);
    const [data, trashData] = await Promise.all([activeRes.json(), trashRes.json()]);

    if (!activeRes.ok || !data.success) throw new Error(data.message || 'Gagal memuat daftar versi.');
    if (!trashRes.ok || !trashData.success) throw new Error(trashData.message || 'Gagal memuat sampah versi.');

    versionCache = new Map(data.data.map(version => [Number(version.id), version]));
    trashVersionCache = new Map(trashData.data.map(version => [Number(version.id), version]));

    if (data.data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Belum ada versi game yang terdaftar.</td></tr>';
    } else {
      tbody.innerHTML = data.data.map(v => {
        const isLatest = v.is_latest === 1;
        const downloadEnabled = v.download_enabled !== 0;
        return `
          <tr>
            <td data-label="Nomor Versi"><b class="version-code-cell">${escapeHtml(v.version_code)}</b></td>
            <td data-label="Tanggal Rilis">${escapeHtml(v.release_date || '-')}</td>
            <td data-label="Ukuran">${escapeHtml(v.file_size || '-')}</td>
            <td data-label="Unduhan"><b class="version-download-count">${Number(v.download_count) || 0}</b> kali</td>
            <td data-label="Status">
              ${isLatest
                ? '<span class="version-status-main">Utama</span>'
                : '<span class="version-status-archive">Arsip</span>'}
            </td>
            <td data-label="Akses Unduhan">
              <button
                type="button"
                class="version-download-toggle ${downloadEnabled ? 'is-enabled' : 'is-disabled'}"
                aria-pressed="${downloadEnabled}"
                aria-label="${downloadEnabled ? 'Nonaktifkan' : 'Aktifkan'} unduhan ${escapeHtml(v.version_code)}"
                onclick="toggleVersionDownload(${v.id}, ${downloadEnabled ? 'false' : 'true'}, this)"
              >
                <span class="version-toggle-track" aria-hidden="true"><span></span></span>
                <span class="version-toggle-copy">${downloadEnabled ? 'Aktif' : 'Nonaktif'}</span>
              </button>
            </td>
            <td data-label="Tindakan">
              <div class="version-row-actions">
                <button type="button" class="btn-version-action edit" onclick="editVersion(${v.id})">Edit</button>
                ${!isLatest ? `<button type="button" class="btn-version-action primary" onclick="setAsLatestVersion(${v.id})">Jadikan Utama</button>` : ''}
                <button type="button" class="btn-version-action trash" onclick="moveVersionToTrash(${v.id})">Ke Sampah</button>
              </div>
            </td>
          </tr>
        `;
      }).join('');
    }

    document.getElementById('versionTrashCount').textContent = String(trashData.data.length);
    if (trashBody) {
      trashBody.innerHTML = trashData.data.length === 0
        ? '<tr><td colspan="4" class="version-trash-empty">Sampah masih kosong.</td></tr>'
        : trashData.data.map(v => `
            <tr>
              <td data-label="Nomor Versi"><b class="version-code-cell">${escapeHtml(v.version_code)}</b></td>
              <td data-label="Tanggal Rilis">${escapeHtml(v.release_date || '-')}</td>
              <td data-label="Dipindahkan">${escapeHtml(formatTime(v.deleted_at))}</td>
              <td data-label="Tindakan"><button type="button" class="btn-version-action restore" onclick="restoreVersion(${v.id})">Pulihkan</button></td>
            </tr>
          `).join('');
    }

  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: #DC2626;">Gagal memuat daftar versi.</td></tr>';
    if (trashBody) trashBody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #DC2626;">Gagal memuat sampah versi.</td></tr>';
  }
}

async function moveVersionToTrash(versionId) {
  const versionCode = versionCache.get(Number(versionId))?.version_code || 'versi ini';
  if (!confirm(`Pindahkan ${versionCode} ke sampah? Versi tidak akan tampil atau bisa diunduh, tetapi masih dapat dipulihkan.`)) return;
  try {
    const res = await fetch(`/api/versions/${versionId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memindahkan versi ke sampah.');
    if (editingVersionId === Number(versionId)) resetVersionForm();
    await loadVersionList();
    loadDashboardStats();
  } catch (err) {
    alert(err.message || 'Gagal memindahkan versi ke sampah.');
  }
}

async function restoreVersion(versionId) {
  const versionCode = trashVersionCache.get(Number(versionId))?.version_code || 'versi ini';
  if (!confirm(`Pulihkan ${versionCode} dari sampah? Unduhan akan tetap nonaktif sampai Anda mengaktifkannya.`)) return;
  try {
    const res = await fetch(`/api/versions/${versionId}/restore`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memulihkan versi.');
    await loadVersionList();
  } catch (err) {
    alert(err.message || 'Gagal memulihkan versi.');
  }
}

async function toggleVersionDownload(versionId, enabled, button) {
  const previousText = button?.querySelector('.version-toggle-copy')?.textContent || '';
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const copy = button.querySelector('.version-toggle-copy');
    if (copy) copy.textContent = 'Menyimpan...';
  }

  try {
    const res = await fetch(`/api/versions/${versionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ download_enabled: enabled })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Gagal memperbarui akses unduhan.');
    await loadVersionList();
  } catch (err) {
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      const copy = button.querySelector('.version-toggle-copy');
      if (copy) copy.textContent = previousText;
    }
    alert(err.message || 'Gagal memperbarui akses unduhan.');
  }
}

async function setAsLatestVersion(versionId) {
  if (!confirm('Jadikan versi ini sebagai rilis utama di halaman download?')) return;
  try {
    const res = await fetch(`/api/versions/${versionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_latest: 1 })
    });
    const data = await res.json();
    if (data.success) {
      loadVersionList();
      loadDashboardStats();
    }
  } catch (err) {
    alert('Gagal mengubah versi utama.');
  }
}

// Helpers
function getOsBadgeClass(os = '') {
  const o = os.toLowerCase();
  if (o.includes('android')) return 'android';
  if (o.includes('windows')) return 'windows';
  if (o.includes('ios')) return 'ios';
  return '';
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  try {
    const d = new Date(timestamp.includes('Z') ? timestamp : timestamp + 'Z');
    return d.toLocaleString('id-ID', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return timestamp;
  }
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

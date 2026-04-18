const state = {
  references: [],
  plans: [],
  jobs: []
};

let refreshTimer = null;

const elements = {
  stats: document.querySelector('#stats'),
  informationList: document.querySelector('#information-list'),
  formatList: document.querySelector('#format-list'),
  unassignedSection: document.querySelector('#unassigned-section'),
  unassignedList: document.querySelector('#unassigned-list'),
  plansList: document.querySelector('#plans-list'),
  jobsList: document.querySelector('#jobs-list'),
  planInfoOptions: document.querySelector('#plan-info-options'),
  planFormatOptions: document.querySelector('#plan-format-options'),
  createReferenceForm: document.querySelector('#create-reference-form'),
  planForm: document.querySelector('#plan-form'),
  statusMessage: document.querySelector('#status-message'),
  refreshButton: document.querySelector('#refresh-button')
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ko-KR');
}

function parseTags(input) {
  return String(input ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function setStatusMessage(message, tone = 'muted') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${tone}`;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    },
    ...options
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || response.statusText || 'Request failed');
  }

  return {
    status: response.status,
    data
  };
}

function getActiveJobCount() {
  return state.jobs.filter((job) => ['queued', 'running'].includes(job.status)).length;
}

function scheduleRefreshIfNeeded() {
  if (refreshTimer) {
    window.clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  if (getActiveJobCount() === 0) {
    return;
  }

  refreshTimer = window.setTimeout(() => {
    loadDashboard(true).catch((error) => {
      console.error(error);
      setStatusMessage(error.message, 'error');
    });
  }, 2500);
}

function renderStats() {
  const infoCount = state.references.filter((reference) => reference.collectionType === 'information').length;
  const formatCount = state.references.filter((reference) => reference.collectionType === 'format').length;
  const analyzedCount = state.references.filter(
    (reference) => reference.status.focusedAnalysis === 'ready'
  ).length;
  const cards = [
    { label: '정보 릴스', value: infoCount },
    { label: '형식 릴스', value: formatCount },
    { label: '완료된 분석', value: analyzedCount },
    { label: '진행 중 작업', value: getActiveJobCount() }
  ];

  elements.stats.innerHTML = cards
    .map(
      (card) => `
        <div class="stat">
          <span class="muted">${escapeHtml(card.label)}</span>
          <strong>${card.value}</strong>
        </div>
      `
    )
    .join('');
}

function badgeClass(value) {
  if (value === 'ready' || value === 'completed') {
    return 'ok';
  }

  if (value === 'failed' || value === 'error') {
    return 'error';
  }

  return 'warn';
}

function renderBadges(reference) {
  const items = [
    { label: `처리 ${reference.status.processing}`, className: badgeClass(reference.status.processing) },
    {
      label: `분석 ${reference.status.focusedAnalysis}`,
      className: badgeClass(reference.status.focusedAnalysis)
    }
  ];

  if (reference.curation.approved) {
    items.push({ label: '선별 완료', className: 'ok' });
  }

  if (reference.status.latestError?.message) {
    items.push({ label: '최근 오류', className: 'error' });
  }

  return items
    .map((item) => `<span class="badge ${item.className}">${escapeHtml(item.label)}</span>`)
    .join('');
}

function renderInformationAnalysis(reference) {
  if (!reference.information) {
    return '<p class="muted">정보 데이터화 전입니다.</p>';
  }

  return `
    <div class="analysis-block">
      <p>${escapeHtml(reference.information.summary || '')}</p>
      <strong>핵심 포인트</strong>
      <ol class="analysis-list">
        ${(reference.information.keyTakeaways || [])
          .map(
            (item) => `
              <li>
                <strong>${escapeHtml(item.headline || '')}</strong><br />
                <span>${escapeHtml(item.detail || '')}</span>
              </li>
            `
          )
          .join('')}
      </ol>
      <strong>주의 포인트</strong>
      <ul class="analysis-list">
        ${(reference.information.cautionNotes || [])
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('') || '<li>없음</li>'}
      </ul>
    </div>
  `;
}

function renderFormatAnalysis(reference) {
  if (!reference.format) {
    return '<p class="muted">형식 데이터화 전입니다.</p>';
  }

  return `
    <div class="analysis-block">
      <p><strong>훅 포뮬러:</strong> ${escapeHtml(reference.format.hookFormula || '')}</p>
      <p><strong>전개 방식:</strong> ${escapeHtml(reference.format.deliveryStyle || '')}</p>
      <strong>씬 플로우</strong>
      <ol class="analysis-list">
        ${(reference.format.sceneFlow || [])
          .map(
            (scene) => `
              <li>
                <strong>${escapeHtml(scene.goal || '')}</strong><br />
                <span>${escapeHtml(scene.deliveryInstruction || '')}</span>
              </li>
            `
          )
          .join('')}
      </ol>
      <strong>재사용 규칙</strong>
      <ul class="analysis-list">
        ${(reference.format.reusableRules || [])
          .map((item) => `<li>${escapeHtml(item)}</li>`)
          .join('') || '<li>없음</li>'}
      </ul>
    </div>
  `;
}

function renderGenericStructure(reference) {
  if (!reference.structure) {
    return '<p class="muted">구조 분석 전입니다.</p>';
  }

  return `
    <div class="analysis-block">
      <p><strong>Hook:</strong> ${escapeHtml(reference.structure.hook?.text || '')}</p>
      <p><strong>Body:</strong> ${escapeHtml(reference.structure.body?.summary || '')}</p>
      <p><strong>CTA:</strong> ${escapeHtml(reference.structure.cta?.text || '')}</p>
    </div>
  `;
}

function renderReferenceCard(reference) {
  const tags = reference.tags.map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join('');
  const poster = reference.sourceSnapshot.posterUrl
    ? `<img src="${escapeHtml(reference.sourceSnapshot.posterUrl)}" alt="" loading="lazy" />`
    : '<div class="reference-placeholder muted">Poster 없음</div>';

  return `
    <article class="reference-card">
      <div class="reference-cover">${poster}</div>
      <div class="reference-body">
        <div class="reference-title">
          <div>
            <h3>${escapeHtml(reference.title || reference.reelId)}</h3>
            <div class="meta-line">
              <span class="muted">${escapeHtml(reference.sourceSnapshot.author || 'author unknown')}</span>
              <span class="muted">${escapeHtml(reference.topic || 'topic 미입력')}</span>
              <span class="muted">${escapeHtml(reference.reelId)}</span>
            </div>
          </div>
          <a href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">원본 열기</a>
        </div>

        <div class="status-row">${renderBadges(reference)}</div>
        <div class="meta-line">${tags || '<span class="muted">태그 없음</span>'}</div>

        <form class="inline-form reference-form" data-reference-id="${escapeHtml(reference.reelId)}">
          <div class="field-row">
            <label>
              <span>제목</span>
              <input name="title" type="text" value="${escapeHtml(reference.title || '')}" />
            </label>
            <label>
              <span>토픽</span>
              <input name="topic" type="text" value="${escapeHtml(reference.topic || '')}" />
            </label>
            <label>
              <span>태그</span>
              <input name="tags" type="text" value="${escapeHtml(reference.tags.join(', '))}" />
            </label>
          </div>

          <div class="metrics-grid">
            <label><span>Views</span><input name="views" type="text" value="${escapeHtml(reference.manualMetrics.views || '')}" /></label>
            <label><span>Likes</span><input name="likes" type="text" value="${escapeHtml(reference.manualMetrics.likes || '')}" /></label>
            <label><span>Comments</span><input name="comments" type="text" value="${escapeHtml(reference.manualMetrics.comments || '')}" /></label>
            <label><span>Saves</span><input name="saves" type="text" value="${escapeHtml(reference.manualMetrics.saves || '')}" /></label>
            <label><span>Shares</span><input name="shares" type="text" value="${escapeHtml(reference.manualMetrics.shares || '')}" /></label>
          </div>

          <div class="field-row">
            <label>
              <span>Retention</span>
              <input name="retention" type="text" value="${escapeHtml(reference.manualMetrics.retention || '')}" />
            </label>
            <label class="wide">
              <span>지표 메모</span>
              <input name="metricsNotes" type="text" value="${escapeHtml(reference.manualMetrics.notes || '')}" />
            </label>
          </div>

          <label>
            <span>운영 메모</span>
            <textarea name="notes" rows="3">${escapeHtml(reference.notes || '')}</textarea>
          </label>

          <div class="field-row">
            <label>
              <span>우선순위</span>
              <input name="priority" type="number" min="0" step="1" value="${escapeHtml(reference.curation.priority || 0)}" />
            </label>
            <label class="wide">
              <span>선별 메모</span>
              <input name="curationNote" type="text" value="${escapeHtml(reference.curation.note || '')}" />
            </label>
            <label>
              <span>선별 완료</span>
              <select name="approved">
                <option value="false" ${reference.curation.approved ? '' : 'selected'}>아직</option>
                <option value="true" ${reference.curation.approved ? 'selected' : ''}>완료</option>
              </select>
            </label>
          </div>

          <div class="action-row">
            <button type="submit">저장</button>
            <button type="button" class="secondary" data-action="process-reference" data-id="${escapeHtml(reference.reelId)}">처리</button>
            <button type="button" class="secondary" data-action="analyze-reference" data-id="${escapeHtml(reference.reelId)}">분석</button>
            <button type="button" class="danger" data-action="delete-reference" data-id="${escapeHtml(reference.reelId)}">삭제</button>
          </div>
        </form>

        <details class="details">
          <summary>분석 보기</summary>
          ${reference.collectionType === 'information' ? renderInformationAnalysis(reference) : ''}
          ${reference.collectionType === 'format' ? renderFormatAnalysis(reference) : ''}
          ${renderGenericStructure(reference)}
          <div class="analysis-block">
            <strong>전사 미리보기</strong>
            <pre>${escapeHtml(reference.transcriptText || reference.transcriptPreview || '')}</pre>
            <div class="action-row">
              <a href="${escapeHtml(reference.assetUrls.video)}" target="_blank" rel="noreferrer">로컬 영상</a>
              <a href="${escapeHtml(reference.assetUrls.transcript)}" target="_blank" rel="noreferrer">전사 파일</a>
              <a href="${escapeHtml(reference.assetUrls.summary)}" target="_blank" rel="noreferrer">요약 파일</a>
            </div>
          </div>
        </details>
      </div>
    </article>
  `;
}

function renderEmptyState(message) {
  return `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function renderReferenceLists() {
  const information = state.references.filter((reference) => reference.collectionType === 'information');
  const format = state.references.filter((reference) => reference.collectionType === 'format');
  const unassigned = state.references.filter((reference) => reference.collectionType === 'unassigned');

  elements.informationList.innerHTML = information.length
    ? information.map(renderReferenceCard).join('')
    : renderEmptyState('아직 저장된 정보 릴스가 없습니다.');

  elements.formatList.innerHTML = format.length
    ? format.map(renderReferenceCard).join('')
    : renderEmptyState('아직 저장된 형식 릴스가 없습니다.');

  elements.unassignedSection.hidden = unassigned.length === 0;
  elements.unassignedList.innerHTML = unassigned.length
    ? unassigned.map(renderReferenceCard).join('')
    : '';
}

function renderSelectionList(references, type) {
  if (references.length === 0) {
    return renderEmptyState(type === 'information' ? '분석된 정보 릴스가 없습니다.' : '분석된 형식 릴스가 없습니다.');
  }

  return references
    .map(
      (reference) => `
        <label class="selection-item">
          <input type="checkbox" name="${type}ReferenceIds" value="${escapeHtml(reference.reelId)}" />
          <div>
            <p><strong>${escapeHtml(reference.title || reference.reelId)}</strong></p>
            <p class="muted">${escapeHtml(reference.topic || reference.analysisSummary || '')}</p>
          </div>
        </label>
      `
    )
    .join('');
}

function renderPlanOptions() {
  const infoOptions = state.references.filter(
    (reference) => reference.collectionType === 'information' && reference.information
  );
  const formatOptions = state.references.filter(
    (reference) => reference.collectionType === 'format' && reference.format
  );

  elements.planInfoOptions.innerHTML = renderSelectionList(infoOptions, 'info');
  elements.planFormatOptions.innerHTML = renderSelectionList(formatOptions, 'format');
}

function renderPlanCard(plan) {
  return `
    <article class="plan-card">
      <div class="plan-body">
        <div>
          <h3>${escapeHtml(plan.title)}</h3>
          <p class="plan-meta">업데이트 ${escapeHtml(formatDate(plan.updatedAt))}</p>
        </div>

        <p>${escapeHtml(plan.summary || '')}</p>
        <div class="meta-line">
          <span class="badge ${badgeClass(plan.status)}">${escapeHtml(plan.status)}</span>
          <span class="badge">정보 ${escapeHtml(plan.infoReferenceIds.join(', '))}</span>
          <span class="badge">형식 ${escapeHtml(plan.formatReferenceIds.join(', '))}</span>
        </div>

        <ol class="scene-list">
          ${(plan.scenes || [])
            .map(
              (scene) => `
                <li>
                  <strong>${escapeHtml(scene.goal || '')}</strong> ${escapeHtml(scene.timing || '')}<br />
                  <span>${escapeHtml(scene.script || '')}</span>
                </li>
              `
            )
            .join('')}
        </ol>

        <form class="inline-form plan-edit-form" data-plan-id="${escapeHtml(plan.planId)}">
          <div class="field-row">
            <label>
              <span>제목</span>
              <input name="title" type="text" value="${escapeHtml(plan.title || '')}" />
            </label>
            <label>
              <span>상태</span>
              <select name="status">
                <option value="draft" ${plan.status === 'draft' ? 'selected' : ''}>draft</option>
                <option value="approved" ${plan.status === 'approved' ? 'selected' : ''}>approved</option>
                <option value="archived" ${plan.status === 'archived' ? 'selected' : ''}>archived</option>
              </select>
            </label>
          </div>
          <label>
            <span>노트</span>
            <textarea name="notes" rows="3">${escapeHtml(plan.notes || '')}</textarea>
          </label>
          <div class="action-row">
            <button type="submit">기획안 저장</button>
            <a href="/data/plans/${escapeHtml(plan.planId)}/plan.md" target="_blank" rel="noreferrer">Markdown</a>
            <button type="button" class="danger" data-action="delete-plan" data-id="${escapeHtml(plan.planId)}">삭제</button>
          </div>
        </form>
      </div>
    </article>
  `;
}

function renderPlans() {
  elements.plansList.innerHTML = state.plans.length
    ? state.plans.map(renderPlanCard).join('')
    : renderEmptyState('아직 생성된 기획안이 없습니다.');
}

function renderJobs() {
  elements.jobsList.innerHTML = state.jobs.length
    ? state.jobs
        .map(
          (job) => `
            <article class="job-card">
              <div class="job-body">
                <div class="status-row">
                  <span class="badge ${badgeClass(job.status)}">${escapeHtml(job.status)}</span>
                  <strong>${escapeHtml(job.label)}</strong>
                </div>
                <p class="job-meta">생성 ${escapeHtml(formatDate(job.createdAt))}</p>
                ${job.error ? `<p class="muted">${escapeHtml(job.error)}</p>` : ''}
              </div>
            </article>
          `
        )
        .join('')
    : renderEmptyState('현재 큐에 쌓인 작업이 없습니다.');
}

function render() {
  renderStats();
  renderReferenceLists();
  renderPlanOptions();
  renderPlans();
  renderJobs();
}

async function loadDashboard(silent = false) {
  const { data } = await requestJson('/api/dashboard');
  state.references = data.references || [];
  state.plans = data.plans || [];
  state.jobs = data.jobs || [];
  render();

  if (!silent) {
    setStatusMessage('워크스페이스를 불러왔습니다.');
  }

  scheduleRefreshIfNeeded();
}

async function saveReference(form) {
  const reelId = form.dataset.referenceId;
  const data = new FormData(form);

  await requestJson(`/api/references/${reelId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: data.get('title'),
      topic: data.get('topic'),
      tags: parseTags(data.get('tags')),
      notes: data.get('notes'),
      manualMetrics: {
        views: data.get('views'),
        likes: data.get('likes'),
        comments: data.get('comments'),
        saves: data.get('saves'),
        shares: data.get('shares'),
        retention: data.get('retention'),
        notes: data.get('metricsNotes')
      },
      curation: {
        approved: data.get('approved') === 'true',
        priority: Number(data.get('priority') || 0),
        note: data.get('curationNote')
      }
    })
  });

  setStatusMessage(`${reelId} 저장 완료`);
  await loadDashboard(true);
}

async function savePlan(form) {
  const planId = form.dataset.planId;
  const data = new FormData(form);

  await requestJson(`/api/plans/${planId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      title: data.get('title'),
      status: data.get('status'),
      notes: data.get('notes')
    })
  });

  setStatusMessage(`${planId} 저장 완료`);
  await loadDashboard(true);
}

async function queueReferenceAction(action, reelId) {
  const endpoint =
    action === 'process-reference'
      ? `/api/references/${reelId}/process`
      : `/api/references/${reelId}/analyze`;

  const { data } = await requestJson(endpoint, {
    method: 'POST',
    body: JSON.stringify({})
  });

  setStatusMessage(`${data.job.label} 작업을 큐에 넣었습니다.`);
  await loadDashboard(true);
}

async function deleteReferenceById(reelId) {
  if (!window.confirm(`${reelId} 를 삭제할까요? 다운로드된 파일도 같이 지워집니다.`)) {
    return;
  }

  await requestJson(`/api/references/${reelId}`, { method: 'DELETE' });
  setStatusMessage(`${reelId} 삭제 완료`);
  await loadDashboard(true);
}

async function deletePlanById(planId) {
  if (!window.confirm(`${planId} 기획안을 삭제할까요?`)) {
    return;
  }

  await requestJson(`/api/plans/${planId}`, { method: 'DELETE' });
  setStatusMessage(`${planId} 삭제 완료`);
  await loadDashboard(true);
}

async function queueBulkAction(action) {
  const endpoint =
    action === 'process-pending'
      ? '/api/references/process-pending'
      : '/api/references/analyze-pending';

  const { data } = await requestJson(endpoint, {
    method: 'POST',
    body: JSON.stringify({})
  });

  setStatusMessage(`${data.job.label} 작업을 큐에 넣었습니다.`);
  await loadDashboard(true);
}

elements.createReferenceForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = new FormData(elements.createReferenceForm);
    await requestJson('/api/references', {
      method: 'POST',
      body: JSON.stringify({
        collectionType: data.get('collectionType'),
        url: data.get('url'),
        title: data.get('title'),
        topic: data.get('topic'),
        tags: parseTags(data.get('tags')),
        notes: data.get('notes')
      })
    });

    elements.createReferenceForm.reset();
    setStatusMessage('링크 저장 완료');
    await loadDashboard(true);
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message, 'error');
  }
});

elements.planForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = new FormData(elements.planForm);
    const infoReferenceIds = data.getAll('infoReferenceIds');
    const formatReferenceIds = data.getAll('formatReferenceIds');

    await requestJson('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        title: data.get('title'),
        topic: data.get('topic'),
        notes: data.get('notes'),
        infoReferenceIds,
        formatReferenceIds
      })
    });

    setStatusMessage('기획안 생성 작업을 큐에 넣었습니다.');
    await loadDashboard(true);
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message, 'error');
  }
});

document.addEventListener('submit', async (event) => {
  const referenceForm = event.target.closest('.reference-form');

  if (referenceForm) {
    event.preventDefault();

    try {
      await saveReference(referenceForm);
    } catch (error) {
      console.error(error);
      setStatusMessage(error.message, 'error');
    }

    return;
  }

  const planForm = event.target.closest('.plan-edit-form');

  if (planForm) {
    event.preventDefault();

    try {
      await savePlan(planForm);
    } catch (error) {
      console.error(error);
      setStatusMessage(error.message, 'error');
    }
  }
});

document.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-action], button[data-bulk-action]');

  if (!button) {
    return;
  }

  try {
    if (button.dataset.bulkAction) {
      await queueBulkAction(button.dataset.bulkAction);
      return;
    }

    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'process-reference' || action === 'analyze-reference') {
      await queueReferenceAction(action, id);
      return;
    }

    if (action === 'delete-reference') {
      await deleteReferenceById(id);
      return;
    }

    if (action === 'delete-plan') {
      await deletePlanById(id);
    }
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message, 'error');
  }
});

elements.refreshButton.addEventListener('click', () => {
  loadDashboard().catch((error) => {
    console.error(error);
    setStatusMessage(error.message, 'error');
  });
});

loadDashboard().catch((error) => {
  console.error(error);
  setStatusMessage(error.message, 'error');
});

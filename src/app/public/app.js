const TITLE_SOURCE_LABELS = {
  manual: '\uC218\uB3D9 \uC81C\uBAA9',
  analysis: '\uBD84\uC11D \uC694\uC57D',
  hook: '\uD6C5 \uBB38\uC7A5',
  transcript: '\uC804\uC0AC \uBB38\uC7A5',
  caption: '\uCEA1\uC158 \uC815\uB9AC',
  format_hook: '\uD615\uC2DD \uD6C5',
  transcript_opening: '\uC804\uC0AC \uCCAB \uBB38\uC7A5',
  structure_hook: '\uAD6C\uC870 \uD6C5',
  caption_opening: '\uCEA1\uC158 \uCCAB \uBB38\uC7A5',
  thumbnail_ocr: '\uC378\uB124\uC77C OCR',
  unresolved: '\uBBF8\uCD94\uCD9C',
  topic_author_fallback: '\uD1A0\uD53D/\uC791\uC131\uC790 \uAE30\uBC18',
  author_fallback: '\uC791\uC131\uC790 \uAE30\uBC18',
  reel_id_fallback: '\uB9B4\uC2A4 ID'
};

const METRIC_FIELDS = [
  { key: 'views', label: '조회' },
  { key: 'likes', label: '좋아요' },
  { key: 'comments', label: '댓글' },
  { key: 'saves', label: '저장' },
  { key: 'shares', label: '공유' },
  { key: 'retention', label: '리텐션' }
];

const state = {
  auth: {
    ready: false
  },
  references: [],
  plans: [],
  jobs: [],
  expandedReferenceIds: new Set(),
  expandedPlanIds: new Set()
};

let refreshTimer = null;

const elements = {
  stats: document.querySelector('#stats'),
  informationList: document.querySelector('#information-list'),
  formatList: document.querySelector('#format-list'),
  unassignedSection: document.querySelector('#unassigned-section'),
  unassignedList: document.querySelector('#unassigned-list'),
  informationMeta: document.querySelector('#information-meta'),
  formatMeta: document.querySelector('#format-meta'),
  unassignedMeta: document.querySelector('#unassigned-meta'),
  plansList: document.querySelector('#plans-list'),
  jobsList: document.querySelector('#jobs-list'),
  planInfoOptions: document.querySelector('#plan-info-options'),
  planFormatOptions: document.querySelector('#plan-format-options'),
  createReferenceForm: document.querySelector('#create-reference-form'),
  planForm: document.querySelector('#plan-form'),
  statusMessage: document.querySelector('#status-message'),
  refreshButton: document.querySelector('#refresh-button'),
  sessionPill: document.querySelector('#session-pill')
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

function formatRelativeDate(value) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function parseTags(input) {
  return String(input ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseUrlList(input) {
  const matches = String(input ?? '').match(/https?:\/\/[^\s,]+/g) ?? [];
  return Array.from(
    new Set(
      matches
        .map((item) => item.replace(/[)\]}.,]+$/, '').trim())
        .filter(Boolean)
    )
  );
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

function badgeClass(value) {
  if (['ready', 'completed', 'approved'].includes(value)) {
    return 'ok';
  }

  if (['failed', 'error'].includes(value)) {
    return 'error';
  }

  return 'warn';
}

function readMetricValue(reference, source, key) {
  return String(reference?.[source]?.[key] ?? '').trim();
}

function getMetricState(reference, key) {
  const manualValue = readMetricValue(reference, 'manualMetrics', key);
  const autoValue = readMetricValue(reference, 'autoMetrics', key);
  const displayValue = readMetricValue(reference, 'displayMetrics', key) || manualValue || autoValue;

  if (manualValue) {
    return {
      value: displayValue,
      source: 'manual',
      sourceLabel: '수동 입력'
    };
  }

  if (autoValue) {
    return {
      value: displayValue,
      source: 'auto',
      sourceLabel: '자동 수집'
    };
  }

  return {
    value: '',
    source: 'missing',
    sourceLabel: '미수집'
  };
}

function isReferenceExpanded(reelId) {
  return state.expandedReferenceIds.has(reelId);
}

function isPlanExpanded(planId) {
  return state.expandedPlanIds.has(planId);
}

function toggleReferenceExpansion(reelId) {
  if (isReferenceExpanded(reelId)) {
    state.expandedReferenceIds.delete(reelId);
  } else {
    state.expandedReferenceIds.add(reelId);
  }

  renderReferenceLists();
}

function togglePlanExpansion(planId) {
  if (isPlanExpanded(planId)) {
    state.expandedPlanIds.delete(planId);
  } else {
    state.expandedPlanIds.add(planId);
  }

  renderPlans();
}

function renderSessionPill() {
  elements.sessionPill.textContent = state.auth.ready ? '자동 처리 가능' : '로그인 필요';
  elements.sessionPill.className = `session-pill ${state.auth.ready ? 'ready' : 'missing'}`;
}

function buildMetricSummary(reference) {
  const entries = METRIC_FIELDS.map((field) => ({
    label: field.label,
    value: getMetricState(reference, field.key).value
  }))
    .filter((entry) => entry.value)
    .slice(0, 4);

  if (entries.length === 0) {
    if (reference.sourceSnapshot?.durationSeconds) {
      return `<span class="muted">길이 ${escapeHtml(reference.sourceSnapshot.durationSeconds.toFixed(1))}초</span>`;
    }

    return '<span class="muted">지표 없음</span>';
  }

  return entries
    .map(
      (entry) => `
        <span class="metric-chip">
          <span>${escapeHtml(entry.label)}</span>
          <strong>${escapeHtml(entry.value)}</strong>
        </span>
      `
    )
    .join('');
}

function renderStatusBadges(reference) {
  const items = [
    {
      label: `처리 ${reference.status.processing}`,
      className: badgeClass(reference.status.processing)
    },
    {
      label: `분석 ${reference.status.focusedAnalysis}`,
      className: badgeClass(reference.status.focusedAnalysis)
    }
  ];

  if (reference.curation?.approved) {
    items.push({
      label: '선별 완료',
      className: 'ok'
    });
  }

  if (reference.status?.latestError?.message) {
    items.push({
      label: '오류 있음',
      className: 'error'
    });
  }

  return items
    .map((item) => `<span class="badge ${item.className}">${escapeHtml(item.label)}</span>`)
    .join('');
}

function renderTagList(tags) {
  if (!Array.isArray(tags) || tags.length === 0) {
    return '<span class="muted">태그 없음</span>';
  }

  return tags
    .slice(0, 4)
    .map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`)
    .join('');
}

function renderTitleSource(reference) {
  const label = TITLE_SOURCE_LABELS[reference.titleSource] ?? '자동 정리';
  return `<span class="title-source">${escapeHtml(label)}</span>`;
}

function renderReferencePreview(reference) {
  if (reference.collectionType === 'information' && reference.information) {
    const takeaways = (reference.information.keyTakeaways || [])
      .slice(0, 3)
      .map(
        (item) => `
          <li>
            <strong>${escapeHtml(item.headline || '')}</strong>
            <span>${escapeHtml(item.detail || '')}</span>
          </li>
        `
      )
      .join('');

    return `
      <div class="panel-block">
        <h3>정보 분석</h3>
        <p>${escapeHtml(reference.information.summary || reference.previewSnippet || '-')}</p>
        <ul class="analysis-list">${takeaways || '<li>아직 요약이 없습니다.</li>'}</ul>
      </div>
    `;
  }

  if (reference.collectionType === 'format' && reference.format) {
    const scenes = (reference.format.sceneFlow || [])
      .slice(0, 3)
      .map(
        (scene) => `
          <li>
            <strong>${escapeHtml(scene.goal || '')}</strong>
            <span>${escapeHtml(scene.deliveryInstruction || scene.visualDirection || '')}</span>
          </li>
        `
      )
      .join('');

    return `
      <div class="panel-block">
        <h3>형식 분석</h3>
        <p><strong>훅</strong> ${escapeHtml(reference.format.hookFormula || '-')}</p>
        <p><strong>전달 방식</strong> ${escapeHtml(reference.format.deliveryStyle || '-')}</p>
        <ul class="analysis-list">${scenes || '<li>아직 장면 요약이 없습니다.</li>'}</ul>
      </div>
    `;
  }

  return `
    <div class="panel-block">
      <h3>미리보기</h3>
      <p>${escapeHtml(reference.previewSnippet || '아직 처리나 분석 결과가 없습니다.')}</p>
    </div>
  `;
}

function renderReferenceMedia(reference) {
  const posterUrl = reference.sourceSnapshot?.posterUrl || '';
  const videoUrl = reference.assetUrls?.video || '';

  if (reference.status?.videoReady && videoUrl) {
    const posterAttribute = posterUrl ? ` poster="${escapeHtml(posterUrl)}"` : '';

    return `
      <div class="media-player-wrap">
        <video class="local-video-player" controls preload="metadata" playsinline${posterAttribute}>
          <source src="${escapeHtml(videoUrl)}" type="video/mp4" />
        </video>
      </div>
    `;
  }

  if (posterUrl) {
    return `
      <div class="detail-poster-wrap">
        <img class="detail-poster" src="${escapeHtml(posterUrl)}" alt="" loading="lazy" />
      </div>
    `;
  }

  return `
    <div class="media-placeholder">
      로컬 영상 파일이 아직 없습니다. 처리 버튼을 먼저 실행해 주세요.
    </div>
  `;
}

function renderReferenceAssets(reference) {
  const links = [
    ['원본 릴스', reference.url],
    ['영상 파일', reference.assetUrls?.video],
    ['전사 파일', reference.assetUrls?.transcript],
    ['요약 파일', reference.assetUrls?.summary]
  ].filter(([, href]) => href);

  return `
    <div class="panel-block">
      <h3>자료와 원본</h3>
      ${renderReferenceMedia(reference)}
      <div class="inline-links">
        ${links
          .map(
            ([label, href]) =>
              `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
          )
          .join('')}
      </div>

      <div class="detail-meta-grid">
        <div>
          <span class="panel-label">제목 출처</span>
          <strong>${escapeHtml(TITLE_SOURCE_LABELS[reference.titleSource] ?? '자동 정리')}</strong>
        </div>
        <div>
          <span class="panel-label">작성자</span>
          <strong>${escapeHtml(reference.sourceSnapshot?.author ? `@${reference.sourceSnapshot.author}` : '-')}</strong>
        </div>
        <div>
          <span class="panel-label">마지막 처리</span>
          <strong>${escapeHtml(formatDate(reference.lastProcessedAt))}</strong>
        </div>
        <div>
          <span class="panel-label">마지막 분석</span>
          <strong>${escapeHtml(formatDate(reference.lastAnalysisAt))}</strong>
        </div>
      </div>

      <details class="subdetails">
        <summary>전사와 구조 보기</summary>
        <div class="subdetails-content">
          ${
            reference.structure
              ? `
                  <div class="structure-grid">
                    <div>
                      <span class="panel-label">Hook</span>
                      <p>${escapeHtml(reference.structure.hook?.text || '-')}</p>
                    </div>
                    <div>
                      <span class="panel-label">Body</span>
                      <p>${escapeHtml(reference.structure.body?.summary || '-')}</p>
                    </div>
                    <div>
                      <span class="panel-label">CTA</span>
                      <p>${escapeHtml(reference.structure.cta?.text || '-')}</p>
                    </div>
                  </div>
                `
              : '<p class="muted">구조 분석이 아직 없습니다.</p>'
          }
          <pre>${escapeHtml(reference.transcriptText || reference.transcriptPreview || '')}</pre>
        </div>
      </details>
    </div>
  `;
}

function renderMetricEditor(reference) {
  return `
    <section class="editor-section metrics-panel">
      <div class="editor-section-head">
        <div>
          <h3>지표</h3>
          <p class="helper-text">수동 입력값이 있으면 자동 수집값보다 우선합니다.</p>
        </div>
      </div>
      <div class="metric-grid">
        ${METRIC_FIELDS.map((field) => {
          const metric = getMetricState(reference, field.key);
          const manualValue = readMetricValue(reference, 'manualMetrics', field.key);
          const placeholder = metric.value || '값 없음';
          return `
            <label class="metric-editor-card">
              <div class="metric-card-head">
                <span class="metric-card-label">${escapeHtml(field.label)}</span>
                <span class="metric-source ${escapeHtml(metric.source)}">${escapeHtml(metric.sourceLabel)}</span>
              </div>
              <strong class="metric-card-value ${metric.value ? '' : 'is-empty'}">${escapeHtml(metric.value || '미수집')}</strong>
              <span class="metric-input-label">수동 보정</span>
              <input
                name="${escapeHtml(field.key)}"
                type="text"
                value="${escapeHtml(manualValue)}"
                placeholder="${escapeHtml(placeholder)}"
                inputmode="${field.key === 'retention' ? 'text' : 'numeric'}"
              />
            </label>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderReferencePanel(reference) {
  return `
    <div class="reference-panel">
      <div class="reference-panel-inner">
        <div class="reference-panel-grid">
          <form class="reference-form editor-form" data-reference-id="${escapeHtml(reference.reelId)}">
            <section class="editor-section">
              <div class="editor-grid editor-grid-3">
                <label>
                  <span>구분</span>
                  <select name="collectionType">
                    <option value="information" ${reference.collectionType === 'information' ? 'selected' : ''}>정보 릴스</option>
                    <option value="format" ${reference.collectionType === 'format' ? 'selected' : ''}>형식 릴스</option>
                    <option value="unassigned" ${reference.collectionType === 'unassigned' ? 'selected' : ''}>미분류</option>
                  </select>
                </label>

                <label class="wide">
                  <span>관리 제목</span>
                  <input
                    name="title"
                    type="text"
                    value="${escapeHtml(reference.manualTitle || '')}"
                    placeholder="${escapeHtml(reference.title || reference.reelId)}"
                  />
                </label>

                <label>
                  <span>토픽</span>
                  <input name="topic" type="text" value="${escapeHtml(reference.topic || '')}" />
                </label>
              </div>
            </section>

            <section class="editor-section">
              <div class="editor-grid editor-grid-2">
                <label>
                  <span>태그</span>
                  <input name="tags" type="text" value="${escapeHtml((reference.tags || []).join(', '))}" />
                </label>

                <label>
                  <span>선별 메모</span>
                  <input name="curationNote" type="text" value="${escapeHtml(reference.curation?.note || '')}" />
                </label>
              </div>
            </section>

            ${renderMetricEditor(reference)}

            <section class="editor-section">
              <div class="editor-grid editor-grid-3">
                <label>
                  <span>우선순위</span>
                  <input name="priority" type="number" min="0" step="1" value="${escapeHtml(reference.curation?.priority || 0)}" />
                </label>

                <label>
                  <span>선별 상태</span>
                  <select name="approved">
                    <option value="false" ${reference.curation?.approved ? '' : 'selected'}>검토 중</option>
                    <option value="true" ${reference.curation?.approved ? 'selected' : ''}>선별 완료</option>
                  </select>
                </label>

                <label class="wide">
                  <span>지표 메모</span>
                  <input name="metricsNotes" type="text" value="${escapeHtml(reference.manualMetrics?.notes || '')}" />
                </label>
              </div>
            </section>

            <label class="editor-section">
              <span>운영 메모</span>
              <textarea name="notes" rows="4">${escapeHtml(reference.notes || '')}</textarea>
            </label>

            <div class="action-row">
              <button type="submit">저장</button>
              <button type="button" class="secondary" data-action="process-reference" data-id="${escapeHtml(reference.reelId)}">처리</button>
              <button type="button" class="secondary" data-action="analyze-reference" data-id="${escapeHtml(reference.reelId)}">분석</button>
              <button type="button" class="danger" data-action="delete-reference" data-id="${escapeHtml(reference.reelId)}">삭제</button>
            </div>
          </form>

          <div class="reference-side">
            ${renderReferencePreview(reference)}
            ${renderReferenceAssets(reference)}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderReferenceRow(reference) {
  const isOpen = isReferenceExpanded(reference.reelId);
  const authorText = reference.sourceSnapshot?.author ? `@${reference.sourceSnapshot.author}` : '작성자 미확인';

  return `
    <article class="reference-row ${isOpen ? 'is-open' : ''}">
      <div class="reference-summary">
        <button
          type="button"
          class="toggle-button"
          data-action="toggle-reference"
          data-id="${escapeHtml(reference.reelId)}"
          aria-expanded="${isOpen ? 'true' : 'false'}"
          aria-label="${isOpen ? '접기' : '펼치기'}"
        >
          ${isOpen ? '-' : '+'}
        </button>

        <div class="reference-main">
          <div class="reference-title-row">
            <strong class="reference-title-text">${escapeHtml(reference.title || reference.reelId)}</strong>
            ${renderTitleSource(reference)}
          </div>
          <div class="reference-subline">
            <span>${escapeHtml(authorText)}</span>
            <span>${escapeHtml(reference.reelId)}</span>
            <span>${escapeHtml(reference.previewSnippet || '')}</span>
          </div>
        </div>

        <div class="reference-cell">
          <span class="cell-label">토픽</span>
          <div class="cell-value">${escapeHtml(reference.topic || '-')}</div>
        </div>

        <div class="reference-cell">
          <span class="cell-label">태그</span>
          <div class="tag-list">${renderTagList(reference.tags)}</div>
        </div>

        <div class="reference-cell">
          <span class="cell-label">지표</span>
          <div class="metrics-cell">${buildMetricSummary(reference)}</div>
        </div>

        <div class="reference-cell">
          <span class="cell-label">상태</span>
          <div class="status-cell">${renderStatusBadges(reference)}</div>
        </div>

        <div class="reference-cell reference-updated">
          <span class="cell-label">업데이트</span>
          <div class="cell-value">${escapeHtml(formatRelativeDate(reference.updatedAt))}</div>
        </div>

        <div class="reference-cell quick-actions">
          <button type="button" class="secondary compact" data-action="process-reference" data-id="${escapeHtml(reference.reelId)}">처리</button>
          <button type="button" class="secondary compact" data-action="analyze-reference" data-id="${escapeHtml(reference.reelId)}">분석</button>
          <a href="${escapeHtml(reference.url)}" target="_blank" rel="noreferrer">원본</a>
        </div>
      </div>

      ${isOpen ? renderReferencePanel(reference) : ''}
    </article>
  `;
}

function renderReferenceTable(references, options = {}) {
  if (references.length === 0) {
    return `<div class="empty-state">${escapeHtml(options.emptyMessage || '아직 데이터가 없습니다.')}</div>`;
  }

  return `
    <div class="reference-table">
      <div class="reference-head">
        <span></span>
        <span>제목</span>
        <span>토픽</span>
        <span>태그</span>
        <span>지표</span>
        <span>상태</span>
        <span>업데이트</span>
        <span>액션</span>
      </div>
      <div class="reference-body-list">
        ${references.map((reference) => renderReferenceRow(reference)).join('')}
      </div>
    </div>
  `;
}

function renderStats() {
  const infoCount = state.references.filter((reference) => reference.collectionType === 'information').length;
  const formatCount = state.references.filter((reference) => reference.collectionType === 'format').length;
  const analyzedCount = state.references.filter((reference) => reference.status?.focusedAnalysis === 'ready').length;
  const cards = [
    { label: '정보 릴스', value: infoCount },
    { label: '형식 릴스', value: formatCount },
    { label: '분석 완료', value: analyzedCount },
    { label: '진행 중 작업', value: getActiveJobCount() }
  ];

  elements.stats.innerHTML = cards
    .map(
      (card) => `
        <article class="stat">
          <span class="muted">${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.value)}</strong>
        </article>
      `
    )
    .join('');
}

function renderReferenceLists() {
  const information = state.references.filter((reference) => reference.collectionType === 'information');
  const format = state.references.filter((reference) => reference.collectionType === 'format');
  const unassigned = state.references.filter((reference) => reference.collectionType === 'unassigned');

  elements.informationMeta.textContent = `${information.length}건`;
  elements.formatMeta.textContent = `${format.length}건`;
  elements.unassignedMeta.textContent = `${unassigned.length}건`;

  elements.informationList.innerHTML = renderReferenceTable(information, {
    emptyMessage: '아직 등록된 정보 레퍼런스가 없습니다.'
  });

  elements.formatList.innerHTML = renderReferenceTable(format, {
    emptyMessage: '아직 등록된 형식 레퍼런스가 없습니다.'
  });

  elements.unassignedSection.hidden = unassigned.length === 0;
  elements.unassignedList.innerHTML = renderReferenceTable(unassigned, {
    emptyMessage: '미분류 레퍼런스가 없습니다.'
  });
}

function renderSelectionList(references, type) {
  if (references.length === 0) {
    return `<div class="empty-state">${escapeHtml(type === 'info' ? '분석된 정보 레퍼런스가 없습니다.' : '분석된 형식 레퍼런스가 없습니다.')}</div>`;
  }

  return references
    .map(
      (reference) => `
        <label class="selection-item">
          <input type="checkbox" name="${escapeHtml(type)}ReferenceIds" value="${escapeHtml(reference.reelId)}" />
          <div>
            <p><strong>${escapeHtml(reference.title || reference.reelId)}</strong></p>
            <p class="muted">${escapeHtml(reference.topic || reference.previewSnippet || '')}</p>
          </div>
        </label>
      `
    )
    .join('');
}

function renderPlanOptions() {
  const infoOptions = state.references.filter((reference) => reference.collectionType === 'information' && reference.information);
  const formatOptions = state.references.filter((reference) => reference.collectionType === 'format' && reference.format);

  elements.planInfoOptions.innerHTML = renderSelectionList(infoOptions, 'info');
  elements.planFormatOptions.innerHTML = renderSelectionList(formatOptions, 'format');
}

function renderPlanCard(plan) {
  const isOpen = isPlanExpanded(plan.planId);

  return `
    <article class="plan-card ${isOpen ? 'is-open' : ''}">
      <div class="plan-summary">
        <button
          type="button"
          class="toggle-button"
          data-action="toggle-plan"
          data-id="${escapeHtml(plan.planId)}"
          aria-expanded="${isOpen ? 'true' : 'false'}"
          aria-label="${isOpen ? '접기' : '펼치기'}"
        >
          ${isOpen ? '-' : '+'}
        </button>

        <div class="plan-summary-main">
          <h3>${escapeHtml(plan.title)}</h3>
          <p class="plan-meta">${escapeHtml(plan.summary || '')}</p>
        </div>

        <div class="plan-summary-side">
          <span class="badge ${badgeClass(plan.status)}">${escapeHtml(plan.status)}</span>
          <span class="muted">${escapeHtml(formatRelativeDate(plan.updatedAt))}</span>
        </div>
      </div>

      ${
        isOpen
          ? `
              <div class="plan-body">
                <div class="meta-line">
                  <span class="badge">정보 ${escapeHtml((plan.infoReferenceIds || []).join(', '))}</span>
                  <span class="badge">형식 ${escapeHtml((plan.formatReferenceIds || []).join(', '))}</span>
                </div>

                <ol class="scene-list">
                  ${(plan.scenes || [])
                    .map(
                      (scene) => `
                        <li>
                          <strong>${escapeHtml(scene.goal || '')}</strong>
                          <span>${escapeHtml(scene.timing || '')}</span>
                          <span>${escapeHtml(scene.script || '')}</span>
                        </li>
                      `
                    )
                    .join('')}
                </ol>

                <form class="inline-form plan-edit-form" data-plan-id="${escapeHtml(plan.planId)}">
                  <div class="editor-grid editor-grid-2">
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
            `
          : ''
      }
    </article>
  `;
}

function renderPlans() {
  elements.plansList.innerHTML = state.plans.length
    ? state.plans.map(renderPlanCard).join('')
    : '<div class="empty-state">아직 생성된 기획안이 없습니다.</div>';
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
                ${job.error ? `<p class="status-message error">${escapeHtml(job.error)}</p>` : ''}
              </div>
            </article>
          `
        )
        .join('')
    : '<div class="empty-state">현재 대기 중인 작업이 없습니다.</div>';
}

function render() {
  renderSessionPill();
  renderStats();
  renderReferenceLists();
  renderPlanOptions();
  renderPlans();
  renderJobs();
}

async function loadDashboard(silent = false) {
  const { data } = await requestJson('/api/dashboard');
  const validReferenceIds = new Set((data.references || []).map((reference) => reference.reelId));
  const validPlanIds = new Set((data.plans || []).map((plan) => plan.planId));

  state.auth = data.auth || { ready: false };
  state.references = data.references || [];
  state.plans = data.plans || [];
  state.jobs = data.jobs || [];
  state.expandedReferenceIds = new Set(
    Array.from(state.expandedReferenceIds).filter((reelId) => validReferenceIds.has(reelId))
  );
  state.expandedPlanIds = new Set(
    Array.from(state.expandedPlanIds).filter((planId) => validPlanIds.has(planId))
  );

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
      collectionType: data.get('collectionType'),
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

  state.expandedReferenceIds.add(reelId);
  setStatusMessage(`${reelId} 저장 완료`, 'success');
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

  state.expandedPlanIds.add(planId);
  setStatusMessage(`${planId} 저장 완료`, 'success');
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

  state.expandedReferenceIds.add(reelId);
  setStatusMessage(`${data.job.label} 작업을 큐에 넣었습니다.`, 'success');
  await loadDashboard(true);
}

async function deleteReferenceById(reelId) {
  if (!window.confirm(`${reelId} 레퍼런스를 삭제할까요? 관련 파일도 함께 제거됩니다.`)) {
    return;
  }

  await requestJson(`/api/references/${reelId}`, {
    method: 'DELETE'
  });

  state.expandedReferenceIds.delete(reelId);
  setStatusMessage(`${reelId} 삭제 완료`, 'success');
  await loadDashboard(true);
}

async function deletePlanById(planId) {
  if (!window.confirm(`${planId} 기획안을 삭제할까요?`)) {
    return;
  }

  await requestJson(`/api/plans/${planId}`, {
    method: 'DELETE'
  });

  state.expandedPlanIds.delete(planId);
  setStatusMessage(`${planId} 삭제 완료`, 'success');
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

  setStatusMessage(`${data.job.label} 작업을 큐에 넣었습니다.`, 'success');
  await loadDashboard(true);
}

elements.createReferenceForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const data = new FormData(elements.createReferenceForm);
    const urls = parseUrlList(data.get('urls'));

    if (urls.length === 0) {
      throw new Error('Instagram 릴스 주소를 하나 이상 넣어 주세요.');
    }

    const { data: responseData } = await requestJson('/api/references', {
      method: 'POST',
      body: JSON.stringify({
        collectionType: data.get('collectionType'),
        urls,
        title: data.get('title'),
        topic: data.get('topic'),
        tags: parseTags(data.get('tags')),
        notes: data.get('notes'),
        autoQueue: data.get('autoQueue') === 'on'
      })
    });

    elements.createReferenceForm.reset();
    elements.createReferenceForm.elements.autoQueue.checked = true;

    const savedCount = responseData.references?.length || urls.length;
    let message = `${savedCount}개 레퍼런스를 저장했습니다.`;
    let tone = 'success';

    if (responseData.autoQueued && responseData.job) {
      message += ` ${responseData.job.label}`;
    } else if (data.get('autoQueue') === 'on') {
      tone = 'warn';
    }

    if (responseData.warning) {
      message = responseData.warning;
      tone = 'warn';
    }

    setStatusMessage(message, tone);
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

    await requestJson('/api/plans', {
      method: 'POST',
      body: JSON.stringify({
        title: data.get('title'),
        topic: data.get('topic'),
        notes: data.get('notes'),
        infoReferenceIds: data.getAll('infoReferenceIds'),
        formatReferenceIds: data.getAll('formatReferenceIds')
      })
    });

    setStatusMessage('기획안 생성 작업을 큐에 넣었습니다.', 'success');
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

  if (!planForm) {
    return;
  }

  event.preventDefault();

  try {
    await savePlan(planForm);
  } catch (error) {
    console.error(error);
    setStatusMessage(error.message, 'error');
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

    if (action === 'toggle-reference') {
      toggleReferenceExpansion(id);
      return;
    }

    if (action === 'toggle-plan') {
      togglePlanExpansion(id);
      return;
    }

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

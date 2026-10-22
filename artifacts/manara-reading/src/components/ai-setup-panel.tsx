import { useState } from 'react';
import { AlertCircle, Check, Cloud, Download, Smartphone, Trash2, X } from 'lucide-react';
import type { useOfflineReading } from '@/hooks/use-offline-reading';

export type Engine = 'device' | 'server';
type Offline = ReturnType<typeof useOfflineReading>;

type Props = {
  offline: Offline;
  engine: Engine;
  onEngineChange: (engine: Engine) => void;
  serverBusy: boolean;
};

function Flag({ ok, label, testId, hint }: { ok: boolean; label: string; testId: string; hint: string }) {
  return (
    <li className={`ai-flag${ok ? ' ok' : ''}`} data-testid={testId}>
      <span className="ai-flag-mark" aria-hidden="true">{ok ? <Check size={11} /> : <X size={11} />}</span>
      <span><strong>{label}: {ok ? 'да' : 'нет'}</strong><em>{hint}</em></span>
    </li>
  );
}

export function AiSetupPanel({ offline, engine, onEngineChange, serverBusy }: Props) {
  const [confirming, setConfirming] = useState(false);
  const busy = offline.busy || serverBusy;
  const model = offline.models.find((item) => item.id === offline.modelId);
  const percent = Math.round(offline.progress * 100);

  return (
    <section className="ai-setup" aria-labelledby="ai-setup-title" data-testid="section-ai-setup">
      <div className="ai-head">
        <div className="micro-label" id="ai-setup-title">Где работает ИИ</div>
        <span className="ai-state" data-testid="status-ai-phase">
          {offline.phase === 'ready' ? 'модель загружена' : offline.phase === 'loading' ? 'загрузка' : offline.phase === 'generating' ? 'идёт разбор' : offline.phase === 'checking' ? 'проверка' : offline.phase === 'unsupported' ? 'не поддерживается' : offline.phase === 'error' ? 'ошибка' : 'не загружена'}
        </span>
      </div>

      <div className="engine-row" role="group" aria-label="Режим ИИ" data-testid="group-ai-engine">
        <button type="button" className="engine-button" aria-pressed={engine === 'device'} disabled={busy}
          data-testid="button-engine-device" onClick={() => onEngineChange('device')}>
          <Smartphone size={14} /><span><strong>На устройстве</strong><em>по умолчанию, вопрос не уходит с телефона</em></span>
        </button>
        <button type="button" className="engine-button" aria-pressed={engine === 'server'} disabled={busy}
          data-testid="button-engine-server" onClick={() => onEngineChange('server')}>
          <Cloud size={14} /><span><strong>Через сервер</strong><em>только по вашему выбору</em></span>
        </button>
      </div>

      {engine === 'server' && (
        <p className="ai-warning" data-testid="text-server-mode-warning">
          Включён серверный режим: вопрос и выбранные карты будут отправлены на сервер и внешнему ИИ-провайдеру только для этого разбора. Приложение их не сохраняет. К серверу мы не переключаемся автоматически: при ошибке вы увидите её и решите сами.
        </p>
      )}

      {engine === 'device' && (
        <div className="ai-device" data-testid="section-device-ai">
          <p className="ai-capability" role="status" data-testid="text-capability-message">{offline.capabilityMessage || 'Проверяем возможности браузера…'}</p>

          {offline.isSupported && (
            <>
              <div className="field-label" id="model-label">Модель</div>
              <div className="model-options" role="group" aria-labelledby="model-label" data-testid="group-model-choice">
                {offline.models.map((item) => (
                  <button key={item.id} type="button" className="depth-card" aria-pressed={offline.modelId === item.id}
                    disabled={busy} data-testid={`button-model-${item.id}`} onClick={() => { setConfirming(false); offline.setModelId(item.id); }}>
                    <strong>{item.label}</strong>
                    <span>Загрузка: {item.downloadLabel}</span>
                  </button>
                ))}
              </div>
              <p className="ai-note" data-testid="text-model-tradeoff">
                Компактная модель (1.5B) быстрее и легче для памяти, но отвечает проще. Тяжёлая (3B) связывает карты лучше, но чаще упирается в память iPhone. Для любой из них возможны слабые ответы и ошибки нехватки памяти.
              </p>

              {offline.phase === 'loading' ? (
                <div className="ai-progress" data-testid="status-model-loading">
                  <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} data-testid="progress-model-load">
                    <span style={{ transform: `scaleX(${offline.progress})` }} />
                  </div>
                  <div className="progress-text"><span data-testid="text-progress">{offline.progressText || 'Подготовка…'}</span><span>{percent}%</span></div>
                  <button type="button" className="retry-button" data-testid="button-cancel-model-load" onClick={offline.cancel}>Отменить</button>
                </div>
              ) : offline.phase === 'generating' ? (
                <div className="ai-progress" data-testid="status-model-generating">
                  <div className="progress-text"><span>Модель читает расклад. Не сворачивайте приложение.</span></div>
                  <button type="button" className="retry-button" data-testid="button-cancel-generation" onClick={offline.cancel}>Остановить разбор</button>
                </div>
              ) : offline.isReady ? (
                <div className="ai-actions">
                  <span className="ai-ready" data-testid="status-model-ready"><Check size={13} />Модель загружена в память</span>
                  <button type="button" className="retry-button" data-testid="button-remove-model" disabled={busy} onClick={() => void offline.removeModel()}>
                    <Trash2 size={12} />Удалить модель
                  </button>
                </div>
              ) : confirming ? (
                <div className="ai-confirm" role="alertdialog" aria-labelledby="confirm-title" data-testid="dialog-download-confirm">
                  <strong id="confirm-title">Скачать {model?.label ?? 'модель'}?</strong>
                  <p>Будет загружено {model?.downloadLabel ?? 'несколько ГБ'}. Это много трафика и места: лучше по Wi-Fi и при зарядке. Держите приложение на экране до конца загрузки. Safari может удалить кэш при нехватке места.</p>
                  <div className="ai-actions">
                    <button type="button" className="draw-action" data-testid="button-confirm-download"
                      onClick={() => { setConfirming(false); void offline.prepare(); }}><Download size={14} />Скачать</button>
                    <button type="button" className="retry-button" data-testid="button-cancel-download-confirm" onClick={() => setConfirming(false)}>Не сейчас</button>
                  </div>
                </div>
              ) : (
                <div className="ai-actions">
                  <button type="button" className="draw-action" disabled={busy} data-testid="button-prepare-model" onClick={() => setConfirming(true)}>
                    <Download size={14} />{offline.isCached ? 'Загрузить модель в память' : 'Подготовить модель'}
                  </button>
                </div>
              )}
            </>
          )}

          {offline.error && (
            <div className="ai-error" role="alert" data-testid="status-ai-error"><AlertCircle size={13} /><span>{offline.error}</span></div>
          )}

          <ul className="ai-flags" aria-label="Состояние кэша" data-testid="list-cache-status">
            <Flag ok={offline.appCached} label="Приложение и 78 изображений в кэше" testId="status-app-cached" hint="Относится только к страницам и картинкам." />
            <Flag ok={offline.isCached} label="Модель в кэше" testId="status-model-cached" hint="Файлы модели сохранены в браузере; Safari может их удалить." />
            <Flag ok={offline.offlineVerified} label="Разбор без сети проверен" testId="status-offline-verified" hint="Только после реально выполненного разбора при отключённой сети." />
          </ul>
          <p className="ai-note" data-testid="text-connection-state">
            Сейчас: {offline.isOnline ? 'сеть есть' : 'сети нет'}; {offline.isStandalone ? 'открыто с экрана «Домой»' : 'открыто во вкладке браузера'}.
          </p>

          <details className="ai-details" data-testid="section-install-help">
            <summary>Установка на iPhone и ограничения</summary>
            <ol>
              <li>Откройте страницу в Safari, нажмите «Поделиться» и выберите «На экран Домой». У iOS нет собственной кнопки установки.</li>
              <li>Запускайте приложение с экрана «Домой» и держите его на переднем плане, пока идёт загрузка или разбор.</li>
              <li>Поддержка iPhone не гарантируется: она зависит от версии iOS, свободной памяти и WebGPU.</li>
              <li>Хранилище может быть очищено системой; тогда модель придётся скачать заново.</li>
              <li>Работа без сети подтверждена, только когда выше стоит «Разбор без сети проверен: да».</li>
            </ol>
            <button type="button" className="retry-button" data-testid="button-refresh-storage" disabled={busy} onClick={() => void offline.refreshStorage()}>Обновить статус хранилища</button>
          </details>
        </div>
      )}
    </section>
  );
}

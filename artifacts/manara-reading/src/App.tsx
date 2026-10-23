import { type CSSProperties, type ReactNode } from 'react';
import { useMemo, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCreateManaraReading } from '@workspace/api-client-react';
import type { ManaraCard, ManaraReading } from '@workspace/api-client-react';
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleHelp,
  Mic,
  MicOff,
  RotateCcw,
  Search,
  Shuffle,
  Sparkles,
  X,
} from 'lucide-react';
import { AiSetupPanel, type Engine } from '@/components/ai-setup-panel';
import { ReadingSettings } from '@/components/reading-settings';
import {
  readReadingPreferences, saveReadingPreferences, TEXT_COLORS, TEXT_SIZES, type ReadingPreferences,
} from '@/lib/reading-preferences';
import { useOfflineReading } from '@/hooks/use-offline-reading';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

type RecognitionResultEvent = {
  resultIndex: number;
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
};

type RecognitionErrorEvent = { error: string };

type BrowserSpeechRecognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onresult: ((event: RecognitionResultEvent) => void) | null;
  onerror: ((event: RecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => BrowserSpeechRecognition;
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
};

function Home() {
  const offline = useOfflineReading();
  const [readingPreferences, setReadingPreferences] = useState(() => {
    try { return readReadingPreferences(window.localStorage); }
    catch { return readReadingPreferences(); }
  });
  const [preferencesSaved, setPreferencesSaved] = useState(true);
  const changeReadingPreferences = (next: ReadingPreferences) => {
    setReadingPreferences(next);
    try { setPreferencesSaved(saveReadingPreferences(window.localStorage, next)); }
    catch { setPreferencesSaved(false); }
  };
  const textSize = TEXT_SIZES.find(item => item.id === readingPreferences.size)!;
  const textColor = TEXT_COLORS.find(item => item.id === readingPreferences.color)!;
  const readingStyle = {
    "--reader-font-size": `${textSize.pixels}px`,
    "--foreground": textColor.hsl,
    "--muted-foreground": textColor.hsl,
    "--card-foreground": textColor.hsl,
    "--primary": textColor.hsl,
    "--secondary-foreground": textColor.hsl,
  } as CSSProperties;
  const [engine, setEngine] = useState<Engine>('device');
  const [deviceError, setDeviceError] = useState('');
  const readingMutation = useCreateManaraReading();
  const [question, setQuestion] = useState('');
  const [dictationState, setDictationState] = useState<'idle' | 'listening' | 'stopped' | 'error' | 'unsupported'>('idle');
  const [dictationMessage, setDictationMessage] = useState('');
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const [gender, setGender] = useState<'woman' | 'man' | 'not_specified'>('not_specified');
  const [mode, setMode] = useState<'detailed' | 'psychological'>('detailed');
  const [selectionMode, setSelectionMode] = useState<'manual' | 'random'>('manual');
  const [randomQuantity, setRandomQuantity] = useState(3);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [validation, setValidation] = useState('');
  const [reading, setReading] = useState<ManaraReading | null>(null);
  const [lastRequest, setLastRequest] = useState<{
    question: string;
    querentGender: 'woman' | 'man' | 'not_specified';
    mode: 'detailed' | 'psychological';
    cardIds: string[];
  } | null>(null);

  const cards = offline.cards;
  const isPending = engine === 'server' ? readingMutation.isPending : offline.isPending;
  const serverErrorText = readingMutation.error instanceof Error ? readingMutation.error.message : 'Сервер вернул ошибку без описания.';
  const hasError = engine === 'server' ? readingMutation.isError : Boolean(deviceError);
  const selectedCards = useMemo(
    () => selectedIds.map((id) => cards.find((card) => card.id === id)).filter((card): card is ManaraCard => Boolean(card)),
    [selectedIds, cards],
  );
  const filteredCards = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('ru');
    return cards.filter((card) => !needle || `${card.name} ${card.keywords.join(' ')}`.toLocaleLowerCase('ru').includes(needle));
  }, [cards, search]);
  const remainingCount = Math.max(0, 12 - selectedIds.length);
  const speechRecognition = typeof window !== 'undefined'
    ? (window as SpeechRecognitionWindow).SpeechRecognition ?? (window as SpeechRecognitionWindow).webkitSpeechRecognition
    : undefined;

  const toggleDictation = () => {
    if (engine === 'device') return;
    if (dictationState === 'listening') {
      recognitionRef.current?.stop();
      setDictationState('stopped');
      setDictationMessage('Диктовка остановлена.');
      return;
    }
    if (!speechRecognition) {
      setDictationState('unsupported');
      setDictationMessage('В этом браузере голосовой ввод недоступен. Вы можете продолжить печатать.');
      return;
    }
    const recognition = new speechRecognition();
    recognition.lang = 'ru-RU';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onstart = () => {
      setDictationState('listening');
      setDictationMessage('Слушаем… Говорите по-русски.');
    };
    recognition.onresult = (event) => {
      const finalText: string[] = [];
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result.isFinal && result[0]?.transcript) finalText.push(result[0].transcript.trim());
      }
      const transcript = finalText.join(' ').trim();
      if (transcript) {
        setQuestion((current) => `${current.trim()}${current.trim() ? ' ' : ''}${transcript}`);
        setValidation('');
      }
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Нет доступа к микрофону. Разрешите его в настройках браузера или введите вопрос текстом.',
        'service-not-allowed': 'Голосовой сервис недоступен. Вы можете продолжить печатать.',
        'no-speech': 'Речь не распознана. Попробуйте ещё раз или введите вопрос текстом.',
        'audio-capture': 'Не удалось подключиться к микрофону. Проверьте устройство или введите вопрос текстом.',
        network: 'Голосовой ввод прервался из-за ошибки соединения. Текстовый ввод доступен.',
      };
      setDictationState('error');
      setDictationMessage(messages[event.error] ?? 'Не удалось распознать речь. Вы можете продолжить печатать.');
    };
    recognition.onend = () => {
      setDictationState((current) => current === 'listening' ? 'stopped' : current);
      setDictationMessage((current) => current === 'Слушаем… Говорите по-русски.' ? 'Диктовка завершена.' : current);
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setDictationState('error');
      setDictationMessage('Не удалось запустить голосовой ввод. Вы можете продолжить печатать.');
    }
  };

  const toggleCard = (cardId: string) => {
    setSelectedIds((current) => {
      if (current.includes(cardId)) return current.filter((id) => id !== cardId);
      if (current.length >= 12) return current;
      return [...current, cardId];
    });
    setValidation('');
  };

  const chooseRandomSpread = () => {
    if (cards.length < randomQuantity) return;
    const pool = [...cards];
    const chosen: ManaraCard[] = [];
    for (let i = 0; i < randomQuantity; i += 1) {
      const index = Math.floor(Math.random() * pool.length);
      chosen.push(pool.splice(index, 1)[0]);
    }
    setSelectedIds(chosen.map((card) => card.id));
    setValidation('');
  };

  const submitReading = (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    if (normalizedQuestion.length < 8) {
      setValidation('Сформулируйте вопрос чуть подробнее — минимум 8 символов.');
      return;
    }
    if (selectedIds.length < 1) {
      setValidation('Выберите хотя бы одну карту из каталога.');
      return;
    }
    if (engine === 'device' && !offline.isReady) {
      setValidation('Сначала подготовьте локальную модель в блоке «Где работает ИИ» или явно выберите серверный режим.');
      return;
    }
    const payload = {
      question: normalizedQuestion,
      querentGender: gender,
      mode,
      cardIds: [...selectedIds],
    };
    setLastRequest(payload);
    runReading(payload);
  };

  const runReading = (payload: NonNullable<typeof lastRequest>) => {
    setReading(null);
    setDeviceError('');
    if (engine === 'server') {
      readingMutation.reset();
      readingMutation.mutate({ data: payload }, { onSuccess: (response) => setReading(response) });
      return;
    }
    offline.generate(payload).then(
      (response) => setReading(response),
      (error: unknown) => setDeviceError(error instanceof Error && error.message ? error.message : 'Локальная модель не смогла завершить разбор.'),
    );
  };

  const retryReading = () => {
    if (lastRequest) runReading(lastRequest);
  };

  const cardImage = (card: ManaraCard) => card.imageUrl
    ? <>
        <img
          src={card.imageUrl}
          alt={card.name}
          className="card-chip"
          loading="lazy"
          data-testid={`image-catalog-card-${card.id}`}
          onError={(event) => {
            event.currentTarget.style.display = 'none';
            const fallback = event.currentTarget.nextElementSibling as HTMLElement | null;
            if (fallback) fallback.style.display = 'grid';
          }}
        />
        <span className="card-chip card-image-fallback" aria-hidden="true">{card.rank || 'М'}</span>
      </>
    : <span className="card-chip" aria-hidden="true">{card.rank || 'М'}</span>;

  return (
    <main className="app-shell" style={readingStyle} data-reader-size={readingPreferences.size}
      data-reader-color={readingPreferences.color} data-testid="page-manara-reading">
      <div className="page-frame">
        <header className="topbar" data-testid="header-reading-journal">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">М</div>
            <div>
              <div className="brand-name">Манара · между строк</div>
              <div className="brand-caption">разбор раскладов на Манара</div>
            </div>
          </div>
          <div className="top-note" data-testid="status-private-session">
            <span className="status-dot" />{engine === 'device' ? 'Режим устройства: вопрос обрабатывается локально и не сохраняется' : 'Серверный режим: вопрос уходит провайдеру ИИ и не сохраняется'}
          </div>
        </header>

        <ReadingSettings value={readingPreferences} onChange={changeReadingPreferences} saved={preferencesSaved} />

        <section className="intro" aria-labelledby="page-title">
          <div>
            <div className="eyebrow">Чтение начинается с вопроса</div>
            <h1 id="page-title">Не значение карты.<br /><em>Её место в вашей истории.</em></h1>
          </div>
          <p className="intro-copy">Манара говорит через отношения, желания и напряжение момента. Задайте вопрос — и мы посмотрим на карты в его контексте.</p>
        </section>

        <div className="workspace">
          <form className="panel compose-panel" onSubmit={submitReading} data-testid="form-reading-request">
            <div className="panel-heading">
              <div>
                <div className="eyebrow">Настройка расклада</div>
                <h2 className="section-title">С чего начнём</h2>
              </div>
              <span className="step-mark">01 / 03</span>
            </div>

            <label className="field-label" htmlFor="reading-question">Ваш вопрос <span className="optional">от 8 до 3000 символов</span></label>
            <div className="question-entry">
              <textarea
                id="reading-question"
                className="question-field"
                data-testid="input-reading-question"
                placeholder="Например: что сейчас происходит между нами и чего я не замечаю?"
                value={question}
                maxLength={3000}
                onChange={(event) => { setQuestion(event.target.value); setValidation(''); }}
                required
              />
              <button type="button" className={`dictation-button${dictationState === 'listening' ? ' listening' : ''}`}
                onClick={toggleDictation} disabled={engine === 'device' || (!speechRecognition && dictationState !== 'unsupported')}
                aria-label={dictationState === 'listening' ? 'Остановить диктовку' : 'Начать диктовку'}
                data-testid="button-question-dictation">
                {dictationState === 'listening' ? <MicOff size={15} /> : <Mic size={15} />}
                <span>{dictationState === 'listening' ? 'Остановить' : 'Диктовать'}</span>
              </button>
            </div>
            {engine === 'device' && <div className="dictation-status dictation-stopped" data-testid="status-dictation-device-off"><AlertCircle size={13} /><span>В режиме устройства диктовка отключена: речевой сервис браузера может работать в облаке. Печатайте вопрос.</span></div>}
            {engine === 'server' && (dictationMessage || !speechRecognition) && <div className={`dictation-status dictation-${!speechRecognition ? 'unsupported' : dictationState}`} role="status" data-testid="status-question-dictation">
              {dictationState === 'error' || !speechRecognition ? <AlertCircle size={13} /> : dictationState === 'listening' ? <span className="listening-dot" /> : <Check size={13} />}
              <span>{dictationMessage || 'Голосовой ввод не поддерживается этим браузером. Введите вопрос текстом.'}</span>
            </div>}
            <div className="field-meta">
              <span>Чем конкретнее вопрос, тем точнее связка карт.</span>
              <span data-testid="text-question-character-count">{question.length} / 3000</span>
            </div>
            <p className="privacy-note" data-testid="text-dictation-privacy-note">Диктовка доступна только в серверном режиме; обработка может выполняться речевым сервисом браузера. Аудио приложение не сохраняет и не отправляет.</p>

            <AiSetupPanel offline={offline} engine={engine} serverBusy={readingMutation.isPending}
              onEngineChange={(next) => { setEngine(next); setDeviceError(''); }} />

            <div className="field-label" id="gender-label">Пол вопрошающего</div>
            <div className="choice-row" role="group" aria-labelledby="gender-label" data-testid="group-querent-gender">
              {([
                ['woman', 'Женщина'],
                ['man', 'Мужчина'],
                ['not_specified', 'Не указывать'],
              ] as const).map(([value, label]) => (
                <button key={value} type="button" className="choice-button" aria-pressed={gender === value}
                  data-testid={`button-gender-${value}`} onClick={() => setGender(value)}>{label}</button>
              ))}
            </div>

            <div className="field-label" id="mode-label">Глубина чтения</div>
            <div className="depth-options" role="group" aria-labelledby="mode-label" data-testid="group-reading-depth">
              <button type="button" className="depth-card" aria-pressed={mode === 'detailed'} disabled={offline.busy || readingMutation.isPending} data-testid="button-mode-detailed" onClick={() => setMode('detailed')}>
                <strong>Подробный разбор</strong>
                <span>Значения, позиции и связи между картами.</span>
              </button>
              <button type="button" className="depth-card" aria-pressed={mode === 'psychological'} disabled={offline.busy || readingMutation.isPending} data-testid="button-mode-psychological" onClick={() => setMode('psychological')}>
                <strong>Психологический</strong>
                <span>Эмоции, мотивы и внутренние динамики.</span>
              </button>
            </div>

            <div className="field-label">Состав расклада</div>
            <div className="draw-mode" role="group" aria-label="Способ выбора карт" data-testid="group-card-selection-mode">
              <button type="button" className="mode-tab" aria-pressed={selectionMode === 'manual'} data-testid="button-selection-manual"
                onClick={() => setSelectionMode('manual')}><BookOpen size={14} />Выбрать вручную</button>
              <button type="button" className="mode-tab" aria-pressed={selectionMode === 'random'} data-testid="button-selection-random"
                onClick={() => setSelectionMode('random')}><Shuffle size={14} />Случайный расклад</button>
            </div>

            <div className="card-select-area" data-testid="section-card-catalog">
              {selectionMode === 'random' && (
                <div className="random-tools" data-testid="section-random-draw-controls">
                  <label className="random-quantity-label" htmlFor="random-card-quantity">Сколько карт вытянуть?</label>
                  <select id="random-card-quantity" className="random-quantity-select" value={randomQuantity}
                    data-testid="select-random-card-quantity" onChange={(event) => setRandomQuantity(Number(event.target.value))}>
                    {Array.from({ length: 12 }, (_, index) => index + 1).map((quantity) => (
                      <option key={quantity} value={quantity}>
                        {quantity} {quantity === 1 ? 'карта' : quantity < 5 ? 'карты' : 'карт'}
                      </option>
                    ))}
                  </select>
                  <button type="button" className="draw-action" data-testid="button-draw-random-spread"
                    disabled={cards.length < randomQuantity}
                    onClick={chooseRandomSpread}>
                    <Shuffle size={14} />Вытянуть
                  </button>
                </div>
              )}
              <div className="card-select-top">
                <span className="micro-label">Карты по порядку</span>
                <span className="selected-count" data-testid="text-selected-card-count">{selectedIds.length} / 12</span>
              </div>
              {selectedCards.length > 0 ? (
                <div className="selected-list" data-testid="list-selected-cards">
                  {selectedCards.map((card, index) => (
                    <div className="selected-card" key={card.id} data-testid={`selected-card-${card.id}`}>
                      <span className="selected-number">{String(index + 1).padStart(2, '0')}</span>
                      {cardImage(card)}
                      <span className="selected-name">{card.name}</span>
                      <button type="button" className="icon-button" aria-label={`Убрать карту ${card.name}`}
                        data-testid={`button-remove-card-${card.id}`} onClick={() => toggleCard(card.id)}><X size={15} /></button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="empty-selection" data-testid="empty-selected-cards">Пока пусто. Добавьте карты из каталога ниже или доверьте выбор случаю.</div>
              )}
              <div className="catalog-tools">
                <div className="search-wrap">
                  <Search size={14} className="search-icon" />
                  <input className="search-field" type="search" placeholder="Найти карту или ключевое слово" value={search}
                    onChange={(event) => setSearch(event.target.value)} data-testid="input-search-cards" aria-label="Поиск карт" />
                </div>
                {selectedIds.length > 0 && <button type="button" className="icon-button" aria-label="Очистить расклад" title="Очистить расклад"
                  data-testid="button-clear-cards" onClick={() => { setSelectedIds([]); setSelectionMode('manual'); }}><RotateCcw size={15} /></button>}
              </div>
              <div className="catalog-list" data-testid="list-card-catalog">
                {filteredCards.length ? filteredCards.map((card) => {
                  const isSelected = selectedIds.includes(card.id);
                  const atLimit = !isSelected && remainingCount === 0;
                  return (
                    <button key={card.id} type="button" className={`catalog-card${isSelected ? ' selected' : ''}`}
                      data-testid={`button-catalog-card-${card.id}`} aria-pressed={isSelected} disabled={atLimit}
                      onClick={() => toggleCard(card.id)}>
                      {cardImage(card)}
                      <span className="catalog-card-name">{card.name}</span>
                      {isSelected && <Check size={13} />}
                    </button>
                  );
                }) : <div className="empty-selection" data-testid="text-no-matching-cards">В каталоге нет совпадений.</div>}
              </div>
              <div className="catalog-attribution" data-testid="text-local-image-library">
                Все 78 изображений хранятся локально
              </div>
              <details className="card-reference" data-testid="section-card-reference">
                <summary data-testid="button-toggle-card-reference">
                  <span>Справка по выбранным картам</span><ChevronDown size={14} />
                </summary>
                {selectedCards.length ? (
                  <div className="reference-list" data-testid="list-card-reference">
                    {selectedCards.map((card, index) => (
                      <div className="reference-card" key={card.id} data-testid={`reference-card-${card.id}`}>
                        <h4>{String(index + 1).padStart(2, '0')} · {card.name}</h4>
                        {card.keywords.length > 0 && <span className="reference-keywords" data-testid={`text-reference-keywords-${card.id}`}>{card.keywords.join(' · ')}</span>}
                        <p data-testid={`text-reference-meaning-${card.id}`}><strong>Значение</strong>{card.meaning}</p>
                        <p data-testid={`text-reference-shadow-${card.id}`}><strong>Тень</strong>{card.shadow}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-selection" data-testid="empty-card-reference">Выберите карты, и здесь появятся их значения.</div>
                )}
              </details>
            </div>

            {validation && <p className="validation-message" role="alert" data-testid="status-form-validation">{validation}</p>}
            <button className="primary-action" type="submit" disabled={isPending || offline.busy || (engine === 'device' && !offline.isReady)}
              data-testid="button-submit-reading">
              {isPending ? <>Собираем смысл расклада <Sparkles size={16} /></> : engine === 'device' && !offline.isReady ? <>Сначала подготовьте модель</> : <>Прочитать расклад <ArrowRight size={16} /></>}
            </button>
            <div className="footer-note">
              <span><CircleHelp size={12} style={{ verticalAlign: '-2px', marginRight: 5 }} />Карты не дают приговоров — только новый угол зрения.</span>
              <span>{engine === 'device' ? <>вопрос обрабатывается<br />на этом устройстве</> : <>вопрос отправляется на сервер<br />только для этого разбора</>}</span>
            </div>
          </form>

          <section className="panel reader-panel" aria-live="polite" data-testid="section-reading-result">
            <div className="reader-top">
              <div>
                <div className="eyebrow">Ваше пространство чтения</div>
                <h2 className="reader-heading">Интерпретация</h2>
              </div>
              <div className="reader-status" data-testid="status-reading-state">
                {isPending ? <><span className="status-dot" />В процессе</> : reading ? <><Check size={13} />Готово</> : <><ChevronDown size={13} />Ожидает вопроса</>}
              </div>
            </div>
            <div className="reader-content">
              {isPending ? (
                <div className="loading-state" data-testid="status-reading-loading">
                  <div className="loading-label">Вглядываемся в связи</div>
                  <div className="skeleton-line" style={{ width: '94%' }} />
                  <div className="skeleton-line" style={{ width: '82%' }} />
                  <div className="skeleton-line" style={{ width: '89%' }} />
                  <div style={{ height: 18 }} />
                  <div className="skeleton-line" style={{ width: '70%' }} />
                  <div className="skeleton-line" style={{ width: '96%' }} />
                  <div className="skeleton-line" style={{ width: '76%' }} />
                  <p className="result-text" style={{ color: 'hsl(var(--muted-foreground))', marginTop: 22 }} data-testid="text-reading-loading-copy">
                    Сопоставляем каждый образ с вашим вопросом. Это займёт немного времени.
                  </p>
                  {engine === 'device' && <button type="button" className="retry-button" data-testid="button-cancel-reading" onClick={offline.cancel}>Остановить</button>}
                </div>
              ) : hasError ? (
                <div className="error-state" role="alert" data-testid="status-reading-error">
                  <div className="error-symbol"><AlertCircle size={20} /></div>
                  <h3>Не получилось прочитать расклад</h3>
                  <p>{engine === 'device' ? 'Локальный разбор не завершён. Причина указана ниже — это не обязательно нехватка памяти или ограничение модели. Вопрос и карты остались в открытой форме; не обновляйте страницу.' : 'Сервер вернул ошибку; автоматических повторов нет. Ваш вопрос и карты остались в открытой форме.'}</p>
                  <p className="error-detail" data-testid="text-reading-error-detail">{engine === 'device' ? deviceError : serverErrorText}</p>
                  <button type="button" className="retry-button" data-testid="button-retry-reading" onClick={retryReading}>Повторить разбор</button>
                </div>
              ) : reading ? (
                <article className="reading-result" data-testid="article-reading">
                  <p className="reading-question" data-testid="text-reading-question">{lastRequest?.question}</p>
                  <section className="result-section">
                    <h3>Общий рисунок</h3>
                    <p className="result-text" data-testid="text-reading-overview">{reading.overview}</p>
                  </section>
                  <section className="result-section">
                    <h3>Карта за картой</h3>
                    <div className="analysis-list" data-testid="list-card-analysis">
                      {reading.cardAnalysis.map((analysis, index) => (
                        <div className="analysis-card" key={`${analysis.cardId}-${index}`} data-testid={`card-analysis-${analysis.cardId}`}>
                          <div className="analysis-head">
                            <span className="analysis-number">{String(analysis.position || index + 1).padStart(2, '0')}</span>
                            <h4>{analysis.cardName}</h4>
                          </div>
                          <p className="analysis-copy" data-testid={`text-card-interpretation-${analysis.cardId}`}>{analysis.interpretation}</p>
                          <div className="analysis-question" data-testid={`text-card-question-connection-${analysis.cardId}`}>
                            <strong>В контексте вопроса</strong> — {analysis.connectionToQuestion}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className="result-section">
                    <h3>Что происходит между картами</h3>
                    <p className="result-text" data-testid="text-card-dynamics">{reading.cardDynamics}</p>
                  </section>
                  <section className="answer-box" data-testid="section-likely-answer">
                    <h3>Вероятный ответ</h3>
                    <p data-testid="text-likely-answer">{reading.likelyAnswer}</p>
                  </section>
                  {reading.alternativeReadings.length > 0 && <section className="result-section">
                    <h3>Другие возможные оттенки</h3>
                    <div className="alternative-list" data-testid="list-alternative-readings">
                      {reading.alternativeReadings.map((item, index) => <span className="alternative-pill" key={`${index}-${item}`} data-testid={`text-alternative-reading-${index}`}>{item}</span>)}
                    </div>
                  </section>}
                  {reading.reflectionQuestions.length > 0 && <section className="result-section">
                    <h3>Вопросы для себя</h3>
                    <ol className="reflection-list" data-testid="list-reflection-questions">
                      {reading.reflectionQuestions.map((item, index) => <li key={`${index}-${item}`} data-testid={`text-reflection-question-${index}`}>{item}</li>)}
                    </ol>
                  </section>}
                </article>
              ) : (
                <div className="welcome-state" data-testid="empty-reading-result">
                  <div className="orbit" aria-hidden="true"><span className="orbit-mark">М</span></div>
                  <h3>Здесь появится ваш разбор</h3>
                  <p>Сформулируйте вопрос, выберите карты в нужном порядке или доверьте выбор случаю.</p>
                  <span className="welcome-caption">прочтение без готовых ответов</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={Home} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

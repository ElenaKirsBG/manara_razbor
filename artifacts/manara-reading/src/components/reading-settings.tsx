import { TEXT_COLORS, TEXT_SIZES, type ReadingPreferences } from "@/lib/reading-preferences";

type Props = {
  value: ReadingPreferences;
  onChange: (value: ReadingPreferences) => void;
  saved: boolean;
};

export function ReadingSettings({ value, onChange, saved }: Props) {
  return (
    <section className="reading-settings" aria-labelledby="reading-settings-title" data-testid="reading-settings">
      <h2 id="reading-settings-title">Удобно читать</h2>
      <fieldset>
        <legend>Размер текста</legend>
        <div className="reading-setting-options">
          {TEXT_SIZES.map(item => (
            <button key={item.id} type="button" aria-pressed={value.size === item.id}
              data-testid={`text-size-${item.id}`} onClick={() => onChange({ ...value, size: item.id })}>
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Цвет текста</legend>
        <div className="reading-setting-options">
          {TEXT_COLORS.map(item => (
            <button key={item.id} type="button" aria-pressed={value.color === item.id}
              data-testid={`text-color-${item.id}`} onClick={() => onChange({ ...value, color: item.id })}>
              <span className="reading-color-dot" style={{ backgroundColor: `hsl(${item.hsl})` }} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      <p className="reading-settings-note" role="status">
        {saved ? "Выбор сохраняется на этом устройстве. Меняются весь интерфейс и текст разбора." :
          "Настройки действуют сейчас, но браузер не разрешил сохранить их после закрытия."}
      </p>
    </section>
  );
}

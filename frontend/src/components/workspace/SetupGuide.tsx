import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Check, Plus, X } from 'lucide-react';

export type GuideStep = 'services' | 'setup' | 'connect';

const muted = { color: 'var(--hub-ink-3)' } as const;
const STEPS: GuideStep[] = ['services', 'setup', 'connect'];

/**
 * The first-run guide on Home: turn services on, finish each one's setup, connect an AI client.
 * Only the current step has a link (the services page, or the first service that needs setup);
 * connecting happens in the Connect card above it.
 */
const SetupGuide: React.FC<{
  testId: string;
  done: Record<GuideStep, boolean>;
  /** Where the setup step leads: the first service that needs something. */
  setupHref: string;
  servicesHref: string;
  /** Shown once services work; hides the guide for this browser. */
  onDismiss?: () => void;
}> = ({ testId, done, setupHref, servicesHref, onDismiss }) => {
  const { t } = useTranslation();
  const current = STEPS.find((step) => !done[step]);
  return (
    <section
      className="hub-card px-4 py-4"
      data-testid={testId}
      aria-labelledby={`${testId}-title`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`${testId}-title`} className="hub-card-title">
            {t('workspacePage.home.guide.title')}
          </h2>
          <p className="hub-sub">{t('workspacePage.home.guide.description')}</p>
        </div>
        {onDismiss && (
          <button
            type="button"
            className="hub-btn ghost sm shrink-0"
            onClick={onDismiss}
            aria-label={t('workspacePage.home.guide.dismiss')}
            title={t('workspacePage.home.guide.dismiss')}
          >
            <X size={14} aria-hidden />
          </button>
        )}
      </div>
      <ol className="mt-3 space-y-3">
        {STEPS.map((step, index) => {
          const isDone = done[step];
          const isCurrent = step === current;
          return (
            <li
              key={step}
              className="flex flex-wrap items-start gap-3"
              data-step={step}
              data-state={isDone ? 'done' : isCurrent ? 'current' : 'todo'}
              aria-current={isCurrent ? 'step' : undefined}
            >
              <span
                aria-hidden
                className="hub-num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
                style={{
                  background: isDone
                    ? 'var(--hub-accent-soft)'
                    : isCurrent
                      ? 'var(--hub-accent)'
                      : 'var(--hub-bg-2)',
                  color: isDone
                    ? 'var(--hub-accent)'
                    : isCurrent
                      ? 'var(--hub-surface)'
                      : 'var(--hub-ink-3)',
                  border: isDone || isCurrent ? 'none' : '1px solid var(--hub-line)',
                }}
              >
                {isDone ? <Check size={13} /> : index + 1}
              </span>
              <div className="min-w-0 flex-1 basis-[180px] pt-0.5">
                <p
                  className={'text-[13px]' + (isCurrent ? ' font-semibold' : '')}
                  style={!isDone && !isCurrent ? muted : undefined}
                >
                  {t(`workspacePage.home.guide.step.${step}.title`)}
                </p>
                <p className="mt-0.5 text-[12px]" style={muted}>
                  {t(`workspacePage.home.guide.step.${step}.hint`)}
                </p>
              </div>
              {isCurrent && step === 'services' && (
                <Link to={servicesHref} className="hub-btn primary sm shrink-0">
                  <Plus size={13} /> {t('workspacePage.home.getStarted.action')}
                </Link>
              )}
              {isCurrent && step === 'setup' && (
                <Link to={setupHref} className="hub-btn primary sm shrink-0">
                  {t('workspacePage.home.guide.step.setup.action')}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SetupGuide;

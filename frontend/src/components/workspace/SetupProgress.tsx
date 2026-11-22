import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { SetupProgress as Progress, SetupStep } from '@/utils/setupSteps';

const muted = { color: 'var(--hub-ink-3)' } as const;

/** The translation key of a step's title, and of the hint shown under the current step. */
const stepKey = (step: SetupStep): string =>
  step.key === 'access' ? `access_${step.variant ?? 'signin'}` : step.key;

const Marker: React.FC<{ step: SetupStep; index: number }> = ({ step, index }) => {
  const done = step.state === 'done';
  const current = step.state === 'current' || step.state === 'blocked';
  return (
    <span
      aria-hidden
      className="hub-num grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold"
      style={{
        background: done
          ? 'var(--hub-accent-soft)'
          : current
            ? 'var(--hub-accent)'
            : 'var(--hub-bg-2)',
        color: done ? 'var(--hub-accent)' : current ? 'var(--hub-surface)' : 'var(--hub-ink-3)',
        border: current || done ? 'none' : '1px solid var(--hub-line)',
      }}
    >
      {done ? <Check size={13} /> : index + 1}
    </span>
  );
};

/**
 * Where one service is in its setup, the same list for every service. It has no buttons of its
 * own: the current step's hint names the button that does it, which stays where it already is.
 */
const SetupProgress: React.FC<{
  name: string;
  progress: Progress;
  /** The service's own setup button, when it offers one. */
  serviceActionLabel?: string;
}> = ({ name, progress, serviceActionLabel }) => {
  const { t } = useTranslation();
  return (
    <section
      className="hub-card px-4 py-4"
      data-testid="setup-progress"
      aria-labelledby="setup-progress-title"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="setup-progress-title" className="hub-card-title">
          {t('workspacePage.setup.title')}
        </h2>
        <span className="text-[12px]" style={muted} data-testid="setup-progress-count">
          {t('workspacePage.setup.count', { done: progress.done, total: progress.total })}
        </span>
      </div>
      <ol className="mt-3 space-y-3">
        {progress.steps.map((step, index) => {
          const key = stepKey(step);
          const active = step.state === 'current' || step.state === 'blocked';
          let hint = '';
          if (step.state === 'blocked') hint = t('workspacePage.setup.hint.blocked');
          else if (active && step.key === 'service') {
            hint = serviceActionLabel
              ? t('workspacePage.setup.hint.service', { name, label: serviceActionLabel })
              : t('workspacePage.setup.hint.serviceNoAction', { name });
          } else if (active) hint = t(`workspacePage.setup.hint.${key}`, { name });
          return (
            <li
              key={step.key}
              className="flex items-start gap-3"
              data-step={step.key}
              data-state={step.state}
              aria-current={active ? 'step' : undefined}
            >
              <Marker step={step} index={index} />
              <div className="min-w-0 pt-0.5">
                <p
                  className={'text-[13px]' + (active ? ' font-semibold' : '')}
                  style={step.state === 'todo' ? muted : undefined}
                >
                  {t(`workspacePage.setup.step.${key}`, { name })}
                  {step.key === 'client' && (
                    <span className="ml-1 text-[12px] font-normal" style={muted}>
                      {t('workspacePage.setup.optional')}
                    </span>
                  )}
                </p>
                {hint && (
                  <p className="mt-0.5 break-words text-[12px]" style={muted}>
                    {hint}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
};

export default SetupProgress;

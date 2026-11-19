import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';
import { CredentialForm } from '../components/credentials/CredentialForm';
import { credentialsRedirect } from '../utils/navigationPermissions';
import { useSettings } from '../contexts/SettingsContext';
import { useAuth } from '../contexts/AuthContext';
import type { User, MyCredentialBinding } from '../types';
import { apiGet, type ApiResponse } from '../utils/fetchInterceptor';

function CredentialList({ baseUrl, showHeading }: { baseUrl: string; showHeading: boolean }) {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const [bindings, setBindings] = useState<MyCredentialBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    try {
      const result = await apiGet<ApiResponse<MyCredentialBinding[]>>(baseUrl);
      if (!result.success) throw new Error(result.message || t('credentials.failed'));
      setBindings(result.data || []);
      setError('');
    } catch (error) {
      setError(error instanceof Error ? error.message : t('credentials.failed'));
    } finally {
      setLoading(false);
    }
  }, [baseUrl, t]);
  useEffect(() => {
    void reload();
  }, [reload]);
  const visible = bindings.filter(
    (binding) => !search.get('server') || binding.serverName === search.get('server'),
  );
  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {showHeading && (
        <div>
          <h1 className="hub-h1">{t('credentials.title')}</h1>
          <p className="hub-sub">{t('credentials.description')}</p>
        </div>
      )}
      {search.has('server') && (
        <button
          className="hub-btn"
          onClick={() =>
            setSearch((params) => {
              params.delete('server');
              return params;
            })
          }
        >
          {t('credentials.showAll')}
        </button>
      )}
      {error && (
        <div
          className="hub-card px-4 py-3 text-sm"
          style={{ color: 'var(--hub-err)' }}
          role="alert"
        >
          {error}
        </div>
      )}
      {loading ? (
        <div className="hub-card p-10 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.loading')}
        </div>
      ) : !visible.length && !error ? (
        <div className="hub-card p-10 text-center text-sm" style={{ color: 'var(--hub-ink-3)' }}>
          {t('credentials.empty')}
        </div>
      ) : null}
      {visible.map((binding) => (
        <CredentialForm
          key={binding.serverName}
          binding={binding}
          bindings={bindings}
          baseUrl={baseUrl}
          onChange={reload}
        />
      ))}
    </div>
  );
}

export default function CredentialsPage() {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { workspaceEnabled, workspaceResolved } = useSettings();
  const [search, setSearch] = useSearchParams();
  const [users, setUsers] = useState<User[]>([]);
  const [error, setError] = useState('');
  const admin = Boolean(auth.user?.isAdmin);
  const username = admin ? search.get('user') || '' : '';
  // With Workspace Mode on this is the administrator's page for other users' credentials;
  // everyone's own credentials are set from the workspace services list.
  const adminPage = workspaceEnabled && admin;
  const redirect = credentialsRedirect(
    { isAdmin: admin, workspaceEnabled },
    { user: search.get('user'), server: search.get('server') },
  );
  const baseUrl = username ? `/users/${encodeURIComponent(username)}/credentials` : '/credentials';
  useEffect(() => {
    // Nothing is fetched until the workspace setting is known and the page is really shown.
    if (!workspaceResolved || !admin || redirect) return;
    let active = true;
    void apiGet<ApiResponse<User[]>>('/users')
      .then((result) => {
        if (!active) return;
        if (!result.success) throw new Error(result.message || t('credentials.failed'));
        setUsers(result.data || []);
      })
      .catch((error: unknown) => {
        if (active) setError(error instanceof Error ? error.message : t('credentials.failed'));
      });
    return () => {
      active = false;
    };
  }, [admin, redirect, workspaceResolved, t]);
  if (!workspaceResolved) {
    return (
      <div
        className="hub-card mx-auto max-w-4xl p-10 text-center text-sm"
        style={{ color: 'var(--hub-ink-3)' }}
        role="status"
      >
        {t('credentials.loading')}
      </div>
    );
  }
  if (redirect) return <Navigate to={redirect} replace />;
  return (
    <div className="space-y-5">
      {adminPage && (
        <div className="max-w-4xl mx-auto">
          <h1 className="hub-h1">{t('credentials.adminTitle')}</h1>
          <p className="hub-sub">{t('credentials.adminDescription')}</p>
        </div>
      )}
      {admin && (
        <div className="max-w-4xl mx-auto">
          <label className="block space-y-1 text-sm">
            <span>{t('credentials.targetUser')}</span>
            <select
              className="hub-input"
              value={username}
              onChange={(event) => {
                const chosen = event.target.value;
                setSearch((params) => {
                  if (chosen) params.set('user', chosen);
                  else {
                    // Back to "choose a user": a leftover ?server= would redirect to the
                    // administrator's own panel.
                    params.delete('user');
                    params.delete('server');
                  }
                  return params;
                });
              }}
            >
              <option value="">
                {t(adminPage ? 'credentials.chooseUser' : 'credentials.myCredentials')}
              </option>
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>
          {(username || !adminPage) && (
            <p className="hub-sub mt-2" data-testid="credentials-subject">
              {username
                ? t('credentials.showingFor', { user: username })
                : t('credentials.showingOwn')}
            </p>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {adminPage && !username ? null : (
        <CredentialList key={baseUrl} baseUrl={baseUrl} showHeading={!adminPage} />
      )}
    </div>
  );
}

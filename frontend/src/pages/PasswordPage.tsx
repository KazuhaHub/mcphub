import React from 'react';
import SettingsPage from './SettingsPage';

// Changing one's own password, which used to be a section of the settings page.
const PasswordPage: React.FC = () => <SettingsPage view="password" />;

export default PasswordPage;

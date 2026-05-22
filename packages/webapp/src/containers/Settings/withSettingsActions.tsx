import { ComponentType } from 'react';
import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import {
  FetchOptions,
  submitOptions,
  addSettings,
} from '@/store/settings/settings.actions';
import type { RootState } from '@/store/reducers';
import type { SettingOption } from '@/store/settings/settings.type';

export interface WithSettingsActionsProps {
  requestSubmitOptions: (form: { options?: Array<SettingOption> }) => Promise<unknown>;
  requestFetchOptions: () => Promise<unknown>;
  addSetting: (group: string, key: string, value: unknown) => void;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithSettingsActionsProps => ({
  requestSubmitOptions: (form) => dispatch(submitOptions({ form })),
  requestFetchOptions: () => dispatch(FetchOptions()),
  addSetting: (group, key, value) => dispatch(addSettings(group, key, value)),
});

export const withSettingsActions = connect(null, mapDispatchToProps);

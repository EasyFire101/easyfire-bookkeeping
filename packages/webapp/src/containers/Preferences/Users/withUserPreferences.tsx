import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { CLOSE_DIALOG, OPEN_DIALOG } from '@/store/types';

export interface WithUserPreferencesProps {
  openDialog: (name: string, payload?: Record<string, unknown>) => void;
  closeDialog: (name: string, payload?: Record<string, unknown>) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithUserPreferencesProps => ({
  openDialog: (name: string, payload?: Record<string, unknown>) =>
    dispatch({ type: OPEN_DIALOG, name, payload }),
  closeDialog: (name: string, payload?: Record<string, unknown>) =>
    dispatch({ type: CLOSE_DIALOG, name, payload }),
});

export const withUserPreferences = connect(null, mapDispatchToProps);

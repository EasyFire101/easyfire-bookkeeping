import { connect } from 'react-redux';
import { Dispatch } from 'redux';
import { setGlobalErrors } from '@/store/global-errors/global-errors.actions';

export interface WithGlobalErrorsActionsProps {
  globalErrorsSet: (errors: Record<string, unknown>) => void;
}

export const mapDispatchToProps = (dispatch: Dispatch): WithGlobalErrorsActionsProps => ({
  globalErrorsSet: (errors: Record<string, unknown>) =>
    dispatch(setGlobalErrors(errors)),
});

export const withGlobalErrorsActions = connect(null, mapDispatchToProps);

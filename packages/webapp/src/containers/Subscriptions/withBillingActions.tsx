import { AnyAction } from 'redux';
import { ThunkDispatch } from 'redux-thunk';
import { connect } from 'react-redux';
import { submitBilling } from '@/store/billing/billing.action';
import type { RootState } from '@/store/reducers';

export interface WithBillingActionsProps {
  requestSubmitBilling: (form: Record<string, unknown>) => Promise<unknown>;
}

export const mapDispatchToProps = (
  dispatch: ThunkDispatch<RootState, unknown, AnyAction>,
): WithBillingActionsProps => ({
  requestSubmitBilling: (form) => dispatch(submitBilling({ form })),
});

export const withBillingActions = connect(null, mapDispatchToProps);

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FundflowClient, VenlyFinanceClient } from "@venlyfinance/sdk";
import { useVenly } from "./provider.js";
import { venlyKeys } from "./keys.js";

type CreatePartyBody = Parameters<VenlyFinanceClient["parties"]["create"]>[0];
type CreateAccountBody = Parameters<VenlyFinanceClient["accounts"]["create"]>[0];
type CreateVibaBody = Parameters<VenlyFinanceClient["virtualBankAccounts"]["create"]>[1];
type CreatePaymentSessionBody = Parameters<
  VenlyFinanceClient["paymentSessions"]["create"]
>[1];
type CreateRampBody = Parameters<FundflowClient["rampRequests"]["create"]>[0];

/** Create a party (individual or organisation), then refresh party lists. */
export function useCreateParty() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreatePartyBody) => finance.parties.create(body),
    onSuccess: (party) => {
      if (party.id) queryClient.setQueryData(venlyKeys.party(party.id), party);
      void queryClient.invalidateQueries({ queryKey: ["venly", "parties"] });
    },
  });
}

export function useCreateAccount() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAccountBody) => finance.accounts.create(body),
    onSuccess: (account) => {
      if (account.id) queryClient.setQueryData(venlyKeys.account(account.id), account);
      void queryClient.invalidateQueries({ queryKey: ["venly", "accounts"] });
    },
  });
}

export function useCreateVirtualBankAccount() {
  const { finance } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { accountId: string; body: CreateVibaBody }) =>
      finance.virtualBankAccounts.create(input.accountId, input.body),
    onSuccess: (_viba, input) => {
      void queryClient.invalidateQueries({
        queryKey: ["venly", "account", input.accountId, "virtual-bank-accounts"],
      });
    },
  });
}

export function useCreatePaymentSession() {
  const { finance } = useVenly();
  return useMutation({
    mutationFn: (input: { accountId: string; body: CreatePaymentSessionBody }) =>
      finance.paymentSessions.create(input.accountId, input.body),
  });
}

export function useCreateRampRequest() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRampBody) => fundflow.rampRequests.create(body),
    onSuccess: (request) => {
      if (request.id) queryClient.setQueryData(venlyKeys.rampRequest(request.id), request);
      void queryClient.invalidateQueries({ queryKey: ["venly", "ramp-requests"] });
    },
  });
}

type CreateBankAccountBody = Parameters<FundflowClient["bankAccounts"]["create"]>[0];
type CreateCompanyWalletBody = Parameters<FundflowClient["companyWallets"]["create"]>[0];
type SetRampAmountBody = Parameters<FundflowClient["rampRequests"]["setAmount"]>[1];
type InitiateRampBody = Parameters<FundflowClient["rampRequests"]["initiate"]>[1];

/** Whitelist a company bank account (created PENDING, verified out-of-band). */
export function useCreateCompanyBankAccount() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBankAccountBody) => fundflow.bankAccounts.create(body),
    onSuccess: (account) => {
      if (account.id) queryClient.setQueryData(venlyKeys.companyBankAccount(account.id), account);
      void queryClient.invalidateQueries({ queryKey: ["venly", "company-bank-accounts"] });
    },
  });
}

/** Whitelist a company wallet (created PENDING; prove ownership out-of-band). */
export function useCreateCompanyWallet() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateCompanyWalletBody) => fundflow.companyWallets.create(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["venly", "company-wallets"] });
    },
  });
}

/** Edit a ramp amount while AWAITING_APPROVAL; carries the optimistic lock. */
export function useSetRampAmount() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: SetRampAmountBody }) =>
      fundflow.rampRequests.setAmount(input.id, input.body),
    onSuccess: (ramp, input) => {
      queryClient.setQueryData(venlyKeys.rampRequest(input.id), ramp);
      void queryClient.invalidateQueries({ queryKey: ["venly", "ramp-requests"] });
    },
  });
}

/** Report the off-ramp crypto leg's transaction hash (initiates processing). */
export function useInitiateRamp() {
  const { fundflow } = useVenly();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: InitiateRampBody }) =>
      fundflow.rampRequests.initiate(input.id, input.body),
    onSuccess: (ramp, input) => {
      queryClient.setQueryData(venlyKeys.rampRequest(input.id), ramp);
      void queryClient.invalidateQueries({ queryKey: ["venly", "ramp-requests"] });
    },
  });
}

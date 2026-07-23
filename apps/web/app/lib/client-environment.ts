"use client";

import { useSyncExternalStore } from "react";

const subscribeToClientEnvironment = () => () => {};
const getDocumentBody = () => document.body;
const getServerDocumentBody = () => null;
const getClientMounted = () => true;
const getServerMounted = () => false;

export function useDocumentBody() {
  return useSyncExternalStore(subscribeToClientEnvironment, getDocumentBody, getServerDocumentBody);
}

export function useClientMounted() {
  return useSyncExternalStore(subscribeToClientEnvironment, getClientMounted, getServerMounted);
}

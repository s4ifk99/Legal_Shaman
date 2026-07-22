"use client";

import { useEffect } from "react";

const CANONICAL_HOST = "www.legalshaman.com";
const APEX_HOSTS = new Set(["legalshaman.com"]);

/** Send apex visitors to www so API calls and cookies stay same-origin. */
export function CanonicalHostRedirect() {
  useEffect(() => {
    const { hostname, pathname, search, hash, protocol } = window.location;
    if (!APEX_HOSTS.has(hostname)) return;
    const target = `${protocol}//${CANONICAL_HOST}${pathname}${search}${hash}`;
    window.location.replace(target);
  }, []);

  return null;
}

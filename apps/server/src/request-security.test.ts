import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedBrowserOrigin, isPrivateOrLoopbackAddress } from "./request-security.js";

test("trusts only loopback and private proxy peers", () => {
  for (const address of ["127.0.0.1", "::1", "10.2.3.4", "172.16.0.1", "172.31.255.254", "192.168.4.5", "fc00::1", "fe80::1", "::ffff:192.168.1.2"]) {
    assert.equal(isPrivateOrLoopbackAddress(address), true, address);
  }
  for (const address of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2001:4860:4860::8888", "invalid"]) {
    assert.equal(isPrivateOrLoopbackAddress(address), false, address);
  }
});

test("matches browser Origin to Host and requires HTTPS in production", () => {
  assert.equal(isAllowedBrowserOrigin(undefined, "relay.example.com", true), true);
  assert.equal(isAllowedBrowserOrigin("https://relay.example.com", "relay.example.com", true), true);
  assert.equal(isAllowedBrowserOrigin("https://relay.example.com:8443", "relay.example.com:8443", true), true);
  assert.equal(isAllowedBrowserOrigin("http://relay.example.com", "relay.example.com", true), false);
  assert.equal(isAllowedBrowserOrigin("https://evil.example.com", "relay.example.com", true), false);
  assert.equal(isAllowedBrowserOrigin("http://localhost:5173", "localhost:5173", false), true);
});

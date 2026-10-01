/**
 * The phone app is opened through this link when cloud sign-in finishes. The
 * sign-in sheet has already taken the result; just go back to Backup & restore.
 */
import { Redirect } from 'expo-router';
import React from 'react';

export default function CloudSignInReturn() {
  return <Redirect href="/backup" />;
}

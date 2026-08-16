import { redirect } from 'next/navigation'

// Self-serve sign up is disabled. Accounts are created by PLNT.
// The previous form lives in page.tsx.disabled if it ever needs to come back.
export default function SignUpPage() {
  redirect('/auth/signin')
}

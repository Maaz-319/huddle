import { SignInButton } from './SignInButton'

export function LandingPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base">
      <div className="text-center p-8 max-w-md mx-auto">
        <h1 className="text-4xl font-bold text-text-primary mb-4">Huddle</h1>
        <p className="text-text-secondary mb-8">
          A simplified Discord: servers, channels, real-time chat, and presence.
        </p>
        <SignInButton />
      </div>
    </div>
  )
}
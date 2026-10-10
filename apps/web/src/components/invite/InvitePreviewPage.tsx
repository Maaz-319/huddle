import { useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from '@tanstack/react-router';
import { ArrowRight, Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { apiClient } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { toast } from '@/stores/toastStore';

interface InvitePreviewResponse {
  server: {
    id: string;
    name: string;
    iconUrl: string | null;
  };
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function getColorFromString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

export function InvitePreviewPage() {
  const params = useParams({ from: '/invite/$code', strict: true });
  const codeValue = params.code;
  const navigate = useNavigate();
  const { user, isHydrated, hydrate } = useAuthStore();
  const { fetchServers } = useServerStore();
  const [server, setServer] = useState<InvitePreviewResponse['server'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const loadInvite = async () => {
      if (!codeValue) return;
      try {
        const response = await apiClient.get<InvitePreviewResponse>(`/invites/${codeValue}`);
        setServer(response.server);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Invalid or expired invite');
      } finally {
        setLoading(false);
      }
    };
    loadInvite();
  }, [codeValue]);

  useEffect(() => {
    if (!isHydrated) {
      hydrate();
    }
  }, [isHydrated, hydrate]);

  const handleJoin = async () => {
    if (!codeValue || joining) return;
    setJoining(true);
    try {
      await apiClient.post<InvitePreviewResponse>(`/invites/${codeValue}/join`);
      await fetchServers();
      toast.success('Joined server!', `Welcome to ${server?.name}`);
      navigate({ to: `/app/${server?.id}` });
    } catch (err) {
      toast.error('Failed to join', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setJoining(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <Loader2 className="h-8 w-8 text-accent-primary animate-spin" />
      </div>
    );
  }

  if (error || !server) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
        <div className="text-center max-w-md">
          <AlertCircle className="h-16 w-16 text-accent-warn mx-auto mb-4" />
          <h1 className="text-text-primary text-xl font-semibold mb-2">Invite Invalid</h1>
          <p className="text-text-muted mb-6">
            {error || 'This invite link is invalid or has expired.'}
          </p>
          <Link to="/">
            <Button variant="primary">
              <ArrowRight className="h-4 w-4 mr-2" />
              Go Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const isMember = user !== null;

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-bg-raised border border-border-subtle rounded-xl overflow-hidden">
          <div className="p-6 text-center">
            {server.iconUrl ? (
              <img 
                src={server.iconUrl} 
                alt="" 
                className="h-20 w-20 rounded-xl mx-auto mb-4 object-cover" 
              />
            ) : (
              <div 
                className="h-20 w-20 rounded-xl mx-auto mb-4 flex items-center justify-center font-bold text-white text-3xl"
                style={{ backgroundColor: getColorFromString(server.name) }}
              >
                {getInitials(server.name)}
              </div>
            )}
            <h1 className="text-text-primary text-2xl font-semibold mb-1">{server.name}</h1>
            <p className="text-text-muted text-sm mb-6">Server Preview</p>
          </div>
          <div className="border-t border-border-subtle p-6">
            {isMember ? (
              <Button 
                variant="primary" 
                className="w-full" 
                size="lg"
                onClick={() => navigate({ to: `/app/${server.id}` })}
              >
                <CheckCircle className="h-4 w-4 mr-2" />
                Already a Member - Open Server
              </Button>
            ) : (
              <Button 
                variant="primary" 
                className="w-full" 
                size="lg"
                onClick={handleJoin}
                disabled={joining || !user}
              >
                {joining ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Joining...
                  </>
                ) : user ? (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Join Server
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4 mr-2" />
                    Sign in to Join
                  </>
                )}
              </Button>
            )}
            {!user && (
              <p className="text-center text-text-muted text-sm mt-3">
                You need to be signed in to join this server.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
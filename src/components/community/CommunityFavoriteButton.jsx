import { useCommunityFavorites } from '../../hooks/useCommunityFavorites';
import { useWeb3 } from '../../contexts/Web3Context';
import { useLanguage } from '../../contexts/LanguageContext';
import { useToast } from '../../contexts/ToastContext';
import './CommunityFavoriteButton.css';

export default function CommunityFavoriteButton({ address }) {
  const { activeChainId } = useWeb3();
  const { isFavorite, toggleFavorite } = useCommunityFavorites(activeChainId);
  const { t } = useLanguage();
  const toast = useToast();
  const selected = isFavorite(address);
  return (
    <button
      type="button"
      className={`btn btn-ghost btn-sm community-favorite-button${selected ? ' is-favorite' : ''}`}
      aria-pressed={selected}
      onClick={event => {
        event.preventDefault();
        event.stopPropagation();
        try {
          toggleFavorite(address);
        } catch {
          toast.error(t('home.favoriteSaveError'));
        }
      }}
    >
      <span aria-hidden="true">{selected ? '★' : '☆'}</span>
      {t(selected ? 'home.unfavorite' : 'home.favorite')}
    </button>
  );
}

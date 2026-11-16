import { type CoAvatar } from "frontend/utils/sprites/avatar";
import { coPortraitUrl } from "frontend/utils/sprites/co";
import { resolvePortrait } from "frontend/utils/sprites/portrait";
import UserAvatar from "../navbar/UserAvatar";

/**
 * The dossier header of the profile page, driven by real `user.publicProfile` data. Shows the chosen
 * CO portrait (or a favourite-CO / monogram fallback), the callsign, an optional real name and the
 * favourite CO. The owner gets an "Edit dossier" button that opens {@link EditProfileModal}.
 */

type Props = {
  name: string;
  realName: string | null;
  avatar: CoAvatar | null;
  favouriteCO: string | null;
  isOwnProfile: boolean;
  onEdit: () => void;
};

const prettyCo = (co: string): string =>
  co
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export function ProfileHeader({
  name,
  realName,
  avatar,
  favouriteCO,
  isOwnProfile,
  onEdit,
}: Props) {
  // Prefer the explicit avatar; else fall back to the favourite CO's art; else a monogram.
  const { image: portraitUrl, pixelated, objectPosition } = resolvePortrait(avatar, favouriteCO);

  return (
    <section className="@relative @mt-4 @overflow-hidden @border @border-primary/30 @bg-black/60 [clip-path:polygon(0_0,100%_0,100%_100%,2%_100%,0_97%)]">
      <div className="@h-2 @w-full @bg-gradient-to-r @from-primary @via-primary-light @to-transparent" />

      <div className="@flex @flex-col @items-center @gap-6 @px-6 @py-8 smallscreen:@flex-row smallscreen:@items-start smallscreen:@gap-10 laptop:@px-12">
        {/* Portrait — clickable to edit on your own profile (the obvious place to change it) */}
        <button
          type="button"
          onClick={isOwnProfile ? onEdit : undefined}
          disabled={!isOwnProfile}
          aria-label={isOwnProfile ? "Change profile picture" : undefined}
          className={`@group @relative @h-48 @w-48 @shrink-0 @overflow-hidden @border-2 @border-primary/60 @bg-gradient-to-b @from-bg-secondary @to-bg-primary [clip-path:polygon(0_0,100%_0,100%_90%,90%_100%,0_100%)] ${
            isOwnProfile ? "@cursor-pointer" : "@cursor-default"
          }`}
        >
          {portraitUrl != null ? (
            <img
              src={portraitUrl}
              alt={name}
              style={{ objectPosition }}
              className={`@absolute @inset-0 @h-full @w-full @object-cover ${
                pixelated ? "[image-rendering:pixelated]" : ""
              }`}
            />
          ) : (
            <UserAvatar name={name} size={192} className="!@rounded-none" />
          )}

          {isOwnProfile && (
            <span className="@absolute @inset-0 @flex @flex-col @items-center @justify-center @gap-1 @bg-black/70 @opacity-0 @transition-opacity @duration-200 group-hover:@opacity-100">
              <CameraIcon />
              <span className="@text-[10px] @font-bold @uppercase @tracking-widest @text-primary-light">
                Change
              </span>
            </span>
          )}
        </button>

        {/* Identity */}
        <div className="@flex @min-w-0 @flex-1 @flex-col @items-center @text-center smallscreen:@items-start smallscreen:@text-left">
          <div className="@flex @w-full @flex-col @gap-2 smallscreen:@flex-row smallscreen:@items-start smallscreen:@justify-between">
            <div className="@min-w-0">
              <h1 className="@truncate @font-russoOne @text-3xl @text-white smallscreen:@text-4xl">
                {name}
              </h1>
              {realName != null && realName !== "" && (
                <p className="@mt-1 @text-sm @text-white/50">{realName}</p>
              )}
            </div>

            {isOwnProfile && (
              <button
                type="button"
                onClick={onEdit}
                className="@shrink-0 @border @border-primary/60 @bg-primary/10 @px-4 @py-1.5 @text-xs @font-bold @uppercase @tracking-wide @text-primary-light @transition-colors hover:@bg-primary/25 hover:@text-white"
              >
                Edit dossier
              </button>
            )}
          </div>

          {favouriteCO != null && (
            <div className="@mt-5 @inline-flex @items-center @gap-2 @self-center @border @border-white/10 @bg-black/40 @py-1 @pl-1 @pr-3 smallscreen:@self-start">
              <img
                src={coPortraitUrl(favouriteCO, "small")}
                alt={prettyCo(favouriteCO)}
                className="@h-7 @w-7 @object-cover [image-rendering:pixelated]"
              />
              <span className="@text-xs @uppercase @tracking-wide @text-white/70">
                Main <span className="@text-white">{prettyCo(favouriteCO)}</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CameraIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      className="@text-primary-light"
    >
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.2" />
    </svg>
  );
}

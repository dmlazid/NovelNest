# NovelNest Updates — 2026-10-07

This folder archives the detailed collection/import information that was previously shown directly on the repository homepage.

## Current collection

The catalog contains these 41 novels as of October 7, 2026. Chapter counts change as imports finish and sources publish updates; check each novel on the live website for its currently available chapters. “Ongoing” does not mean every source chapter has already been imported.

| Novel | Source / edition |
| --- | --- |
| Got a Gallery in the Wild | FreeWebNovel |
| Astral Pet Store | FreeWebNovel |
| Extra's Path: The Eternal Frost Monarch | EPUB with ongoing updates |
| Getting $10 Million From My First Sign-In | EPUB with ongoing updates |
| His Discarded Luna, the Rival's Obsession | EPUB with ongoing updates |
| SSS Rank Awakening: The World Beyond Redemption | EPUB with ongoing updates |
| Farming Space Makes Me Rich | EPUB |
| Cultivation Online | FreeWebNovel |
| Investing In My Three Crippled Wives Get 10,000x Times Return | FreeWebNovel |
| Supreme Magus | FreeWebNovel |
| The Innkeeper | FreeWebNovel |
| Farming? No, She Is Cultivating Immortality | AkkNovel |
| Mistakenly Bound by the System? Let’s Squeeze Out a Space First! | AkkNovel |
| Transmigrated as Long Aotian’s Love Rival | AkkNovel |
| Who Gets It! The Marquis’s Concubine-Born Daughter’s Inner Voice is Auto-Broadcasting | AkkNovel |
| Raiding a Home and Finding His Own Daughter, the Tyrant Father Chickened Out | AkkNovel |
| Zombie Apocalypse: Me and My Cat | AkkNovel |
| Directed Leakage of Inner Voice: I Pretended to Be a God Undergoing Tribulations | AkkNovel |
| After Kicking Over the Scumbag, the Whole City Wants to Marry Me | AkkNovel |
| You Make Money, I’ll Spend It: Stepmother’s Ultimate Pleasure in the Aristocratic Family | AkkNovel |
| The Ancient Miss Transmigrates into a CEO’s Wife | AkkNovel |
| Woke Up to Find the Game I Made Came True | AkkNovel |
| The Fake Heiress’s Inner Thoughts Were Heard by Her Entire Family | AkkNovel |
| The Villainess Marries the Gentle Second Male Lead | AkkNovel |
| She Live Streams Modern Life to Ancient People After Failing to Conquer the Emperor | AkkNovel |
| The Real Daughter Gets Rich Writing Paranormal Stories | AkkNovel |
| Top Assassin Retires and Becomes a Farmer After Time Traveling to the Past | AkkNovel |
| Eating Melons Until I Saw News of My Own Death | AkkNovel |
| Serious Slouch, Zen Harem Battle | AkkNovel |
| The Novelist Forced to Become Famous | AkkNovel |
| The Laid-back Life of a Stepmother | AkkNovel |
| This Is Strange | AkkNovel |
| The Genius Female Forensic Pathologist, The Psychological Anatomist | AkkNovel |
| Rebirth Stockpiling: The Little Girl Sweeps Through the Apocalypse | AkkNovel |
| When the Street-Smart Girl Transmigrates into a Novel About the Real and Fake Heiresses | AkkNovel |
| A Precious Pearl in the Imperial City | AkkNovel |
| I Use My Beauty to Charm Big Shots | AkkNovel |
| All Filial Descendants Kneel Down, I Am Your Great-Grandmother | AkkNovel |
| High-born Matriarch’s Husband-Taming Manual | AkkNovel |
| After the Beautiful Mother Was Taken by Force | AkkNovel |
| I’m Very Happy After Marrying the CEO Husband According to the Agreement | AkkNovel |


### Authorized FreeWebNovel import batch

A new 13-title authorized FreeWebNovel batch is now importing in resumable 100-chapter checkpoints. The importer rotates through every title so very long series do not block the rest of the batch, publishes each saved checkpoint, and continues automatically until all titles are caught up.

- Black Tech Internet Cafe System
- Shadow Slave
- Martial God Asura
- Reincarnation Of The Strongest Sword God
- Martial Peak
- Mechanical God Emperor
- Prodigiously Amazing Weaponsmith
- Necropolis Immortal
- Infinite Mana In The Apocalypse
- Reborn at Boot Camp: General, Don't Mess Around!
- My Vampire System
- Mesmerizing Ghost Doctor
- God of Fishing

These titles should be counted as live only after their catalog/chapter checkpoint is committed and a Pages deployment succeeds.

### Second authorized FreeWebNovel import batch

Another 13 authorized FreeWebNovel titles have been registered in the same resumable importer. They will use the same 100-chapter checkpoint system and automatic six-hour updater:

- She Shocks The Whole World After Retirement
- Godly Empress Doctor
- Chaotic Sword God
- Re: Evolution Online
- I Was Caught up in a Hero Summoning, but That World Is at Peace
- Fey Evolution Merchant
- Remarried Empress
- Overgeared
- Dimensional Descent
- Legend of Swordsman
- Madam's Identities Shocks the Entire City Again
- The Author's POV
- Keyboard Immortal

When both 13-title FreeWebNovel batches have produced their first successful catalog checkpoints, NovelHaven will have 67 registered novels in total.

### Third authorized FreeWebNovel import batch

A third authorized FreeWebNovel batch has been registered in the same resumable importer. These 18 titles will join the existing queue and use the same 100-chapter checkpoint system:

- Turns Out I'm in a Villain Clan
- Evolving My Undead Legion in a Game-Like World
- The Beginning After The End
- SSS-Class Suicide Hunter
- Cultivation Chat Group
- The Long-awaited Mr Han
- Supreme Harem God System
- My Werewolf System
- Tyranny of Steel
- Godly Stay-Home Dad
- My Rich Wife
- Hidden Marriage: A Heaven-sent Billionaire Husband
- The Emperor Wants to Marry the Doctor
- I Have the Alchemy Emperor in My Head
- Versatile Mage
- Alchemy Emperor of the Divine Dao
- I'm the King of Technology
- Lady Gu Is Too Weak to Fend for Herself

After all 18 titles produce their first successful catalog checkpoints, NovelHaven will have 85 registered novels in total.

## Routing and deployment work

- Added clean novel URLs under `/novel/<id>/`.
- Added clean chapter URLs under `/novel/<id>/chapter-<number>/`.
- Added generated crawlable novel/chapter pages and sitemap entries.
- Added clean-route compatibility work to remove visible hash routes from normal navigation.
- FreeWebNovel imports continue in resumable 100-chapter checkpoints.
- GitHub Pages deployment and validation continue through Actions.

For current live import progress, check the repository Actions page.

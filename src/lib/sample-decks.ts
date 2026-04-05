import type { DeckFormat } from './deck-utils'

export interface SampleDeck {
  name: string
  format: DeckFormat
  cards: { scryfallId: string; quantity: number; zone: 'main' }[]
}

export const SAMPLE_DECKS: SampleDeck[] = [
  {
    name: '5-Color Dragons',
    format: 'casual',
    cards: [
      { scryfallId: '68625010-3e4e-4400-b503-bf381a7fd81b', quantity: 4, zone: 'main' }, // Chromatic Lantern
      { scryfallId: '1e845758-8f5a-4ed7-ae02-ba4286ae1b65', quantity: 2, zone: 'main' }, // Kyodai, Soul of Kamigawa
      { scryfallId: 'ed23cb11-72a0-48fd-87a9-611f0c266ee5', quantity: 4, zone: 'main' }, // Niv-Mizzet, Dracogenius
      { scryfallId: 'c569fab1-6901-40ab-b958-001698819585', quantity: 2, zone: 'main' }, // Atarka, World Render
      { scryfallId: '1a294ddb-e209-4f6f-8a14-34e95506c01a', quantity: 2, zone: 'main' }, // Earthquake Dragon
      { scryfallId: '16ef1f9a-513d-4f83-91ae-edec0d58e90a', quantity: 2, zone: 'main' }, // Dragonborn Champion
      { scryfallId: 'bd8fa327-dd41-4737-8f19-2cf5eb1f7cdd', quantity: 2, zone: 'main' }, // Black Lotus
      { scryfallId: '7d9e0a23-d2a8-40a6-9076-ed6fb539141b', quantity: 2, zone: 'main' }, // Cromat
      { scryfallId: '8d5cf3a1-2228-4143-b07d-de082380b5e7', quantity: 2, zone: 'main' }, // Two-Headed Hellkite
      { scryfallId: 'b5e1e94d-6876-4351-9c6e-98882e277ccc', quantity: 4, zone: 'main' }, // Crosis's Charm (Krosys Amulett)
      { scryfallId: '6846b15b-b9b1-490d-9243-66eaa14d1478', quantity: 4, zone: 'main' }, // Sprite Dragon (Syphiden-Drache)
      { scryfallId: '5d6b5054-2224-4f68-9d82-3ed17c5dacc4', quantity: 4, zone: 'main' }, // Dovin's Veto
      { scryfallId: '6639a226-8bb9-4af9-98f5-ed3e2c484710', quantity: 2, zone: 'main' }, // Kolaghan's Command
      { scryfallId: 'fd65cdd5-7ea9-4e05-b87a-259311acbe71', quantity: 2, zone: 'main' }, // Niv-Mizzet Reborn
      { scryfallId: 'b0d161fc-4a2a-4f1d-82b4-a746552552df', quantity: 4, zone: 'main' }, // Savannah
      { scryfallId: '47033ba4-8f26-4a6b-97bd-5b366327325e', quantity: 4, zone: 'main' }, // Tropical Island
      { scryfallId: '2f607e7e-30c0-45e9-8f61-bf6e9fe63f2b', quantity: 4, zone: 'main' }, // Volcanic Island
      { scryfallId: 'bd7567df-b4d8-41a8-8eac-c05afa784bfe', quantity: 4, zone: 'main' }, // Bayou
      { scryfallId: 'bb979a96-a57d-4fb5-8ebe-0bd398272abe', quantity: 4, zone: 'main' }, // Plateau
    ],
  },
  {
    name: 'Lifegain',
    format: 'casual',
    cards: [
      { scryfallId: 'db2510a5-55b5-4810-bdea-3bb1d854186b', quantity: 3, zone: 'main' }, // Arrest
      { scryfallId: '9005d98f-cd4f-416d-90d6-ed5fc35e1a29', quantity: 2, zone: 'main' }, // Soul Warden
      { scryfallId: '607b4f02-8ed4-458b-b419-298074a83eaf', quantity: 2, zone: 'main' }, // Asceticism
      { scryfallId: '0fdb27e3-42d4-4eac-be83-378c2e1c9b2f', quantity: 3, zone: 'main' }, // Ajani's Pridemate
      { scryfallId: '6a0b230b-d391-4998-a3f7-7b158a0ec2cd', quantity: 3, zone: 'main' }, // Llanowar Elves
      { scryfallId: 'a390a7df-b8da-41aa-93e5-2c0db938a27e', quantity: 4, zone: 'main' }, // Avacyn's Pilgrim
      { scryfallId: '251bb0a1-784f-44bc-81a0-9bbff2024a6f', quantity: 3, zone: 'main' }, // Well of Lost Dreams
      { scryfallId: '850d1ff4-75f6-444f-b8f1-1d4f99e2718b', quantity: 2, zone: 'main' }, // Stream of Life
      { scryfallId: 'd94342b3-26f8-4149-8c3c-f4d6ec9af6ce', quantity: 3, zone: 'main' }, // Sol Ring
      { scryfallId: 'b8a499a1-bda2-418b-b76d-46c813125e35', quantity: 4, zone: 'main' }, // Archangel of Thune
      { scryfallId: '7c0a30b2-5bec-4205-ba61-317f8ef0acfe', quantity: 4, zone: 'main' }, // Serra Ascendant
      { scryfallId: '0554ffb3-dc13-4ce5-8a4e-b104d93d0965', quantity: 4, zone: 'main' }, // Swiftfoot Boots
      { scryfallId: '640ed00a-75ee-490b-8983-feca59814f5a', quantity: 1, zone: 'main' }, // Lifecreed Duo
    ],
  },
  {
    name: 'Mono Black',
    format: 'casual',
    cards: [
      { scryfallId: '2f67f77f-1a82-4ff5-b926-f31bd720ca4b', quantity: 4, zone: 'main' }, // Squelching Leeches
      { scryfallId: '07aa2c70-af67-44c0-9c3d-7825ba56795b', quantity: 4, zone: 'main' }, // Solemn Simulacrum
      { scryfallId: 'c4677fad-c210-480e-89db-000cd3526d8e', quantity: 4, zone: 'main' }, // Raise Dead
      { scryfallId: '85f31494-9897-4cd5-b84c-d20c2c116e21', quantity: 4, zone: 'main' }, // Burnished Hart
      { scryfallId: '0784b6f0-9ebf-43d2-ba0f-a6bc93ba0c48', quantity: 2, zone: 'main' }, // Phyrexian Arena
      { scryfallId: '0783365b-c54f-471e-bdf2-1f384e065a48', quantity: 4, zone: 'main' }, // Tendrils of Corruption
      { scryfallId: '5ec048df-0123-404a-bec4-6cd0f548062e', quantity: 3, zone: 'main' }, // Nightmare
      { scryfallId: 'a8667e4b-2562-45aa-8e04-e04c43aeee1d', quantity: 4, zone: 'main' }, // Drain Life
      { scryfallId: 'efbe9b9d-0a33-4429-bb77-d6b793aa92a3', quantity: 2, zone: 'main' }, // Nightmare Lash
      { scryfallId: 'f7c0cf16-81ea-45e3-99cc-4424d59bb44b', quantity: 4, zone: 'main' }, // Doomed Dissenter
      { scryfallId: '3a027e0d-f95d-4942-b70f-312ca5c5a95d', quantity: 25, zone: 'main' }, // Swamp
    ],
  },
  {
    name: 'Merfolk Tribal',
    format: 'casual',
    cards: [
      { scryfallId: '6ae8ea86-46c3-4855-92e9-7906e554becb', quantity: 4, zone: 'main' }, // Merrow Reejerey
      { scryfallId: '8088984a-115a-451c-a914-cdfc998ec3c0', quantity: 4, zone: 'main' }, // Merfolk of the Pearl Trident
      { scryfallId: 'bf3cc005-5ec4-41b3-826a-315b35ad1eea', quantity: 4, zone: 'main' }, // Triton Shorestalker
      { scryfallId: 'ddae5e42-6ea8-4c2f-9a42-83f7206cdf2b', quantity: 4, zone: 'main' }, // Curiosity
      { scryfallId: 'd32edff3-c05b-4705-8d79-2080f694119e', quantity: 4, zone: 'main' }, // Merfolk Sovereign
      { scryfallId: 'ed00ac83-cb72-4be9-bd10-9566ce26d498', quantity: 4, zone: 'main' }, // Sygg, River Guide
      { scryfallId: '73089d34-dcb7-49eb-8fb8-2a2a8b4a157d', quantity: 4, zone: 'main' }, // Divination
      { scryfallId: 'a9407b60-8921-4531-bdbe-9a82aaa38d28', quantity: 4, zone: 'main' }, // Lord of Atlantis
      { scryfallId: '3e2936b0-c69f-40f0-aa97-dd0de7352fc3', quantity: 2, zone: 'main' }, // Unsummon
      { scryfallId: '8a840062-f871-4b72-88cb-6e8b916d9b54', quantity: 4, zone: 'main' }, // Counterspell
      { scryfallId: '75933a95-6769-4d4c-baa4-89e32922fc88', quantity: 4, zone: 'main' }, // Arcane Flight
      { scryfallId: 'b6250b8b-1943-445f-ada9-30b41eb6d29b', quantity: 2, zone: 'main' }, // Mindspring Merfolk
      { scryfallId: '72a0fd08-c646-4682-a1db-cf2a24a15f08', quantity: 2, zone: 'main' }, // Coral Merfolk
      { scryfallId: 'f8fae146-a0dd-4622-ab11-f00b372f8221', quantity: 2, zone: 'main' }, // Vodalian Soldiers
      { scryfallId: '36fe6951-d372-4069-b542-84b8df7aefdc', quantity: 18, zone: 'main' }, // Island
    ],
  },
  {
    name: 'Green Stompy',
    format: 'casual',
    cards: [
      { scryfallId: 'b8b4ebbf-1613-42a0-97ff-2f36dc8d984a', quantity: 2, zone: 'main' }, // Dungrove Elder
      { scryfallId: '479722c7-3019-4517-a120-8864b7426b88', quantity: 1, zone: 'main' }, // Lignify
      { scryfallId: '5c32f8b7-bd85-483b-bbbf-6091bdf5d9ef', quantity: 3, zone: 'main' }, // Adventurous Impulse
      { scryfallId: '79932aa6-b5b0-4812-8b35-6dcd46b52fbd', quantity: 3, zone: 'main' }, // Colossal Dreadmaw
      { scryfallId: 'c1db84d8-d426-4c0d-b44e-5be7b0f5f5bf', quantity: 4, zone: 'main' }, // Gigantosaurus
      { scryfallId: '2407dfd8-70ad-4372-8532-df06878301e4', quantity: 4, zone: 'main' }, // Elvish Mystic
      { scryfallId: '6a0b230b-d391-4998-a3f7-7b158a0ec2cd', quantity: 3, zone: 'main' }, // Llanowar Elves
      { scryfallId: '4bd44302-312e-402b-84d7-487c83f185fa', quantity: 2, zone: 'main' }, // Healer of the Glade
      { scryfallId: '305078a5-ac18-4721-bba2-3434eba5b1cf', quantity: 3, zone: 'main' }, // Ornithopter
      { scryfallId: '3e15bab5-551e-48ca-9dec-9e2548c5d8d9', quantity: 2, zone: 'main' }, // Loxodon Warhammer
      { scryfallId: '370fed7c-6993-4f12-a1cf-8c5c64fb0034', quantity: 2, zone: 'main' }, // Mask of Memory
      { scryfallId: '44511449-78ac-4b6b-aa53-aaef3ffdaf12', quantity: 1, zone: 'main' }, // Short Sword
      { scryfallId: '284e165e-9ab6-47fc-9685-0fb03de237df', quantity: 1, zone: 'main' }, // Llanowar Reborn (Wiedererwachter Llanowar)
      { scryfallId: '9cf22bc7-3231-43f8-9b41-045f1b70baa2', quantity: 3, zone: 'main' }, // Garruk's Uprising
      { scryfallId: 'f169dfb2-e4c8-46e9-8591-e51bb82da082', quantity: 17, zone: 'main' }, // Forest
    ],
  },
  {
    name: 'Rakdos Aggro',
    format: 'casual',
    cards: [
      { scryfallId: '4f0993bf-ed8b-4597-84e9-5173483c8e58', quantity: 11, zone: 'main' }, // Mountain
      { scryfallId: '3a027e0d-f95d-4942-b70f-312ca5c5a95d', quantity: 11, zone: 'main' }, // Swamp
      { scryfallId: '4d431445-d7db-4ce1-b422-41494d9be1b4', quantity: 4, zone: 'main' }, // Reassembling Skeleton
      { scryfallId: '282099f3-e2a7-470d-8097-b6cc247eb033', quantity: 4, zone: 'main' }, // Young Pyromancer
      { scryfallId: '4a8d3b19-ed16-49d1-9dc5-3557c729d2d6', quantity: 4, zone: 'main' }, // Dark Ritual
      { scryfallId: '31f802a6-88d0-47d5-a6a9-968a794ddb2b', quantity: 2, zone: 'main' }, // Seething Song
      { scryfallId: '6c354f92-426c-4b50-a947-135bdeb988f6', quantity: 3, zone: 'main' }, // Terminate
      { scryfallId: '08838865-a9b6-4323-96a2-0d3a7aba9d3d', quantity: 3, zone: 'main' }, // Morbid Opportunist
      { scryfallId: '7dea7997-546d-474a-b362-31714abe2bb5', quantity: 2, zone: 'main' }, // Bedevil
      { scryfallId: 'ff4aa630-3a10-4705-a0b0-e89ed7c2e37b', quantity: 4, zone: 'main' }, // Sign in Blood
      { scryfallId: '04460708-b70e-42de-b595-1b58dc79d32f', quantity: 4, zone: 'main' }, // Guttersnipe
      { scryfallId: 'e900c1eb-968b-4046-b824-c167a7a5b682', quantity: 4, zone: 'main' }, // Sedgemoor Witch (Schilfmoorhexe)
      { scryfallId: '085172fd-7101-496b-8f76-26a81a590f67', quantity: 4, zone: 'main' }, // Lightning Bolt
    ],
  },
]

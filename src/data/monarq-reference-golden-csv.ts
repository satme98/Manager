/**
 * GOLDEN REFERENCE — MONARQ_reference_Excel_pour_controle.csv
 * NEVER used as a data source for the application's stock calculations.
 * Used strictly by the Stage 10 Parity Test ("Contrôle vs Excel") to verify
 * that the app's stock-engine and repository layer produce 100% identical
 * figures to the user's original Excel workbook.
 */

export const GOLDEN_REFERENCE_DASHBOARD_KPIS = {
  valeurStock: 79352.45,
  achatsCumules: 95989.05,
  facturesImpayees: 26938.55,
  pertesDeclarees: 0,
  produitsCritiquesExcel: 0, // Because Etat Stock has Stock minimum empty/0 on all 345 rows
  produitsCritiquesBaseProduits: 197, // When using Stock minimum from Base Produits (243 filled, 102 empty)
  valeurSorties: 9905.05,
} as const

export const GOLDEN_REFERENCE_ETAT_STOCK_CSV = `Référence,Produit,Catégorie,Unité,Stock initial,Entrées,Sorties,Pertes,Stock final,Stock minimum,Alerte,Prix U moyen,Valeur stock (MAD)
P001,Bœuf,Viandes & Charcuterie,kg,0,119,2,0,117,,À définir,107.23,12545.66
P002,Filet de bœuf,Viandes & Charcuterie,kg,0,13.2,0,0,13.2,,À définir,221.97,2930.00
P003,Filet pur Black Angus,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P004,Steak de bœuf,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P005,Viande hachée,Viandes & Charcuterie,kg,0,8,0,0,8,0,À définir,110.00,880.00
P006,Travers de bœuf,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P007,Poulet KG (u),Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P008,Bacon de bœuf,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P009,Bacon de bœuf fumé,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P010,Dinde fumée,Viandes & Charcuterie,kg,0,2,0,0,2,0,À définir,191.34,382.68
P011,Jambon de dinde,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P012,Pepperoni,Viandes & Charcuterie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P013,Saucisses kg (u),Viandes & Charcuterie,kg,0,5,0,0,5,0,À définir,101.09,505.46
P014,Khlii,Viandes & Charcuterie,kg,0,27,3,0,22,0,À définir,115.00,2530.00
P015,Saumon fumé,Poissons & Fruits de mer,kg,0,7.7,0,0,7.7,0,À définir,121.56,936.00
P016,Pavé de saumon,Poissons & Fruits de mer,kg,0,0,0,0,0,0,À définir,0.00,0.00
P017,Thon,Poissons & Fruits de mer,kg,0,0,2,0,1,0,À définir,0.00,0.00
P018,Crevettes,Poissons & Fruits de mer,kg,0,0,0,0,0,0,À définir,0.00,0.00
P019,Gambas gris kg (u),Poissons & Fruits de mer,kg,0,82,0,0,82,0,À définir,65.00,5330.00
P020,Fruits de mer,Poissons & Fruits de mer,kg,0,0,0,0,0,0,À définir,0.00,0.00
P021,Anchois,Poissons & Fruits de mer,kg,0,0,0,0,0,0,À définir,0.00,0.00
P022,Tomates,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P023,Tomates cerises,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P024,Tomates séchées,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P025,Concombre,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P026,Laitue,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P027,Salade iceberg,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P028,Mesclun,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P029,Roquette,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P030,Champignons,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P031,Épinards,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P032,Pommes de terre,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P033,Maïs,Fruits & Légumes,kg,0,0,4,0,11,0,À définir,0.00,0.00
P034,Poivron vert,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P035,Oignon podre (u),Fruits & Légumes,kg,0,4,0,0,5,0,À définir,90.00,450.00
P036,Oignon rouge,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P037,Ail,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P038,Avocat,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P039,Pêche,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P040,Orange,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P041,Citron,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P042,Ananas,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P043,Mangue,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P044,Banane,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P045,Pomme,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P046,Fraise,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P047,Fruits rouges,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P048,Gingembre kg(u),Fruits & Légumes,kg,0,1,0,0,1,0,À définir,60.00,60.00
P049,Piment,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P050,Menthe,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P051,Basilic,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P052,Romarin,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P053,Ciboulette,Fruits & Légumes,kg,0,0,0,0,0,0,À définir,0.00,0.00
P054,LES ŒUFS 30PS (u),Œufs,unité,0,70,24,0,20,0,À définir,33.60,672.00
P055,Œufs de caille,Œufs,unité,0,0,1,0,1,0,À définir,0.00,0.00
P056,Lait 6 PC (u),Produits laitiers & Fromages,L,0,15,2,0,4,0,À définir,54.95,219.80
P057,Crème fraîche xlent,Produits laitiers & Fromages,L,0,30,0,0,30,0,À définir,64.97,1949.10
P058,Beurre,Produits laitiers & Fromages,kg,0,10,0,0,10,0,À définir,125.37,1253.70
P059,Yaourt,Produits laitiers & Fromages,kg,0,72,72,0,0,0,À définir,2.12,0.00
P060,Fromage blanc,Produits laitiers & Fromages,kg,0,2,0,0,2,0,À définir,44.95,89.90
P061,Fromage frais,Produits laitiers & Fromages,kg,0,0,0,0,0,0,À définir,0.00,0.00
P062,Fromage à tartiner,Produits laitiers & Fromages,kg,0,4,0,0,4,0,À définir,56.55,226.20
P063,Jben arabe,Produits laitiers & Fromages,kg,0,0,0,0,0,0,À définir,0.00,0.00
P064,Edam,Produits laitiers & Fromages,kg,0,5,0,0,5,0,À définir,211.77,1058.84
P065,Emmental,Produits laitiers & Fromages,kg,0,1,0,0,1,0,À définir,526.37,526.37
P066,Cheddar,Produits laitiers & Fromages,kg,0,2,2,0,0,0,À définir,370.22,0.00
P067,Parmesan (u),Produits laitiers & Fromages,kg,0,26,0,0,26,0,À définir,65.77,1710.02
P068,Mozzarella,Produits laitiers & Fromages,kg,0,30,0,0,30,0,À définir,62.53,1876.00
P069,Burrata,Produits laitiers & Fromages,unité,0,0,0,0,0,0,À définir,0.00,0.00
P070,Stracciatella,Produits laitiers & Fromages,kg,0,0,0,0,0,0,À définir,0.00,0.00
P071,Feta,Produits laitiers & Fromages,kg,0,1,0,0,1,0,À définir,54.80,54.80
P072,Fromage de chèvre,Produits laitiers & Fromages,kg,0,1,0,0,1,0,À définir,261.03,261.03
P073,Manchego,Produits laitiers & Fromages,kg,0,1,0,0,1,0,À définir,780.85,780.85
P074,La Vache qui rit,Produits laitiers & Fromages,unité,0,10,2,0,7,0,À définir,73.52,514.64
P075,Mascarpone,Produits laitiers & Fromages,kg,0,0,0,0,0,0,À définir,0.00,0.00
P076,Pain,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P077,Pain complet,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P078,Pain aux céréales,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P079,Pain grillé,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P080,Toast,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P081,Tartine aux céréales,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P082,Bagel,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P083,Brioche (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P084,Croissant (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P085,Mini-viennoiseries (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P086,Pistolets (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P087,Msemen (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P088,Baghrir (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P089,Harcha (u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P090,Pancakes,Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P091,Gaufres liégeoises ps(u),Boulangerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P092,Penne ps (u),Pâtes & Féculents,unité,0,60,16,0,21,0,À définir,9.50,199.50
P093,Spaghetti ps(u),Pâtes & Féculents,unité,0,72,4,0,115,0,À définir,14.50,1667.50
P094,Linguine ps(u),Pâtes & Féculents,unité,0,4,3,0,6,0,À définir,0.00,0.00
P095,Tagliatelles ps(u),Pâtes & Féculents,unité,0,31,0,0,22,0,À définir,22.27,489.94
P096,Fusilli ps(u),Pâtes & Féculents,unité,0,12,1,0,8,0,À définir,9.50,76.00
P097,Lasagnes ps(u),Pâtes & Féculents,unité,0,0,1,0,4,0,À définir,0.00,0.00
P098,Riz / risotto kg(u),Pâtes & Féculents,unité,0,15,0,0,15,0,À définir,17.92,268.80
P099,Farine fino10 kg(u),Pâtes & Féculents,unité,0,2,0,0,1,0,À définir,108.00,108.00
P100,Chapelure 10 kg (u),Pâtes & Féculents,unité,0,1,0,0,1,0,À définir,360.00,360.00
P101,Huile d’olive 5l(u),Épicerie,unité,0,3,2,0,1,0,À définir,225.00,225.00
P102,Huile de tabel 5l (u),Épicerie,unité,0,26,6,0,13,0,À définir,82.00,1066.00
P103,Huile de truffe (u),Épicerie,unité,0,6,0,0,5,0,À définir,165.00,825.00
P104,Vinaigre balsamique (u),Épicerie,unité,0,0,2,0,15,0,À définir,0.00,0.00
P105,Vinaigre blanc (u),Épicerie,unité,0,12,4,0,11,0,À définir,8.00,88.00
P106,Sel (u),Épicerie,unité,0,10,0,0,16,0,À définir,5.50,88.00
P107,Poivre kg(u),Épicerie,unité,0,1,0,0,1,0,À définir,100.00,100.00
P108,Sucre 1kg(u),Épicerie,unité,0,55,10,0,37,0,À définir,6.05,223.95
P109,Miel pc (u),Épicerie,unité,0,0,0,0,1,0,À définir,0.00,0.00
P110,Confiture pc(u),Épicerie,unité,0,0,1,0,9,0,À définir,0.00,0.00
P111,Nutella (u),Épicerie,unité,0,1,0,0,1,0,À définir,430.00,430.00
P112,Lotus / spéculoos (u),Épicerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P113,Amlou (u),Épicerie,unité,0,12,1,0,8,0,À définir,100.00,800.00
P114,Granola (u),Épicerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P115,Amandes kg (u),Épicerie,unité,0,2,0,0,2,0,À définir,95.00,190.00
P116,Éclats d’amandes kg (u),Épicerie,unité,0,3,0,0,3,0,À définir,125.00,375.00
P117,Pistaches (u),Épicerie,unité,0,0,0,0,1,0,À définir,0.00,0.00
P118,Pignons de pin kg,Épicerie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P119,Cacahuètes / beurre de cacahuète,Épicerie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P120,Cacao,Épicerie,kg,0,2,0,0,2,0,À définir,110.00,220.00
P121,Caramel,Épicerie,kg,0,1,0,0,1,0,À définir,90.00,90.00
P122,Vanille pc(u),Épicerie,unité,0,60,4,0,7,0,À définir,3.85,26.95
P123, cafe rida kg (u) ,Épicerie,unité,0,6,1,0,1,0,À définir,132.00,132.00
P124,Thé 4011(u),Épicerie,unité,0,30,11,0,21,0,À définir,94.00,1974.00
P125,Thé noir (u),Épicerie,unité,0,0,0,0,0,0,À définir,0.00,0.00
P126,Verveine (u),Épicerie,unité,0,1,0,0,1,0,À définir,80.00,80.00
P127,Safran pc(u),Épicerie,unité,0,1,0,0,1,0,À définir,23.00,23.00
P128,Paprika kg,Épicerie,kg,0,2,0,0,2,0,À définir,40.00,80.00
P129,Cannelle kg,Épicerie,kg,0,1,0,0,1,0,À définir,60.00,60.00
P130,Muscade kg,Épicerie,kg,0,1,0,0,1,0,À définir,90.00,90.00
P131,Moutarde (u),Épicerie,unité,0,4,0,0,4,0,À définir,33.00,132.00
P132,Sauce soja (u),Épicerie,unité,0,12,0,0,11,0,À définir,10.00,110.00
P133,Tahini kg,Épicerie,kg,0,0,0,0,0,0,À définir,0.00,0.00
P134,Pois chiches kg,Épicerie,kg,0,0,1,0,7,0,À définir,0.00,0.00
P135,Épices barbecue kg,Épices & Assaisonnements,kg,0,0,0,0,0,0,À définir,0.00,0.00
P136,Épices satay,Épices & Assaisonnements,kg,0,0,0,0,0,0,À définir,0.00,0.00
P137,Épices couscous,Épices & Assaisonnements,kg,0,0,0,0,0,0,À définir,0.00,0.00
P138,Épices tajine,Épices & Assaisonnements,kg,0,0,0,0,0,0,À définir,0.00,0.00
P139,Herbes aromatiques,Épices & Assaisonnements,kg,0,0,0,0,0,0,À définir,0.00,0.00
P140,Levure chimique 100 pc(u),Épices & Assaisonnements,unité,0,16,0,0,15,0,À définir,37.00,555.00
P141,Ketchup / base tomate,Préparations / Bases,kg,0,12,0,0,11,0,À définir,20.00,220.00
P142,Grenadine,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P143,Lait de coco (u),Préparations / Bases,unité,0,0,0,0,8,0,À définir,0.00,0.00
P144,Jus de citron,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P145,Jus d’orange,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P146,Jus d’ananas,Préparations / Bases,L,0,0,3,0,7,0,À définir,0.00,0.00
P147,Jus de carotte,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P148,Jus de pomme,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P149,Jus de mangue,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P150,Jus de fraise,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P151,Jus de fruits rouges,Préparations / Bases,L,0,6,0,0,3,0,À définir,27.00,81.00
P152,Fruit de la passion,Préparations / Bases,kg,0,0,0,0,1,0,À définir,0.00,0.00
P153,Eau gazeuse,Préparations / Bases,L,0,0,0,0,0,0,À définir,0.00,0.00
P154,Oreo,Pâtisserie & Desserts,ps,0,0,0,0,0,0,À définir,0.00,0.00
P155,Kinder Bueno,Pâtisserie & Desserts,ps,0,0,0,0,0,0,À définir,0.00,0.00
P156,Ferrero Rocher,Pâtisserie & Desserts,kg,0,0,0,0,0,0,À définir,0.00,0.00
P157,Nougat ,Pâtisserie & Desserts,kg,0,0,0,0,0,0,À définir,0.00,0.00
P158,Noisettes kg,Pâtisserie & Desserts,kg,0,2,0,0,2,0,À définir,56.25,112.50
P159,Fruits secs,Pâtisserie & Desserts,kg,0,0,0,0,0,0,À définir,0.00,0.00
P160,Chantilly,Pâtisserie & Desserts,kg,0,0,0,0,0,0,À définir,0.00,0.00
P161,Glace vanille,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P162,Glace pistache,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P163,Glace noisette,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P164,Glace caramel,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P165,Glace Kinder Bueno,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P166,Glace Ferrero Rocher,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P167,Glace chocolat,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P168,Glace nougat,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P169,Glace yaourt amarena,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P170,Glace fruits des bois,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P171,Glace fraise,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P172,Glace citron,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P173,Glace passion,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P174,Glace ananas,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P175,Glace mangue,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P176,Glace tiramisu,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P177,Glace Oreo,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P178,Glace café,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P179,Glace banane,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P180,Glace coco,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
P181,Glace chewing-gum,Pâtisserie & Desserts,L,0,0,0,0,0,0,À définir,0.00,0.00
p182,film alimentair grand,emporte&nettoyage,unité,0,6,1,0,2,0,À définir,42.00,84.00
p183,film alimentair petite,emporte&nettoyage,unité,0,6,0,0,5,0,À définir,17.50,87.50
p184,alumminium (u),emporte&nettoyage,unité,0,6,0,0,5,0,À définir,118.80,594.00
p185,les gants (u) ,emporte&nettoyage,unité,0,20,4,0,10,0,À définir,66.00,660.00
p186,charlotte noir 100 pc(u),emporte&nettoyage,unité,0,2,0,0,1,0,À définir,48.00,48.00
p187,emport care lasagn 100 pc (u),emporte&nettoyage,unité,0,4,1,0,3,0,À définir,84.00,252.00
p188,emport care rips 100 pc(u),emporte&nettoyage,unité,0,4,0,0,4,0,À définir,450.00,1800.00
p189,emport brnch 100ps (u),emporte&nettoyage,unité,0,2,0,0,2,0,À définir,426.00,852.00
p190,emport salad 50ps (u),emporte&nettoyage,unité,0,2,0,0,2,0,À définir,142.51,285.01
p191,emport les pats 50 pc (u),emporte&nettoyage,unité,0,5,0,0,5,0,À définir,147.00,735.00
p192,emporte crep noir 50 pc(u),emporte&nettoyage,unité,0,5,0,0,5,0,À définir,180.00,900.00
p193,emport boit sauc noir 100 pc(u),emporte&nettoyage,unité,0,5,1,0,3,0,À définir,30.00,90.00
p194,emport fromag noir 100 pc(u),emporte&nettoyage,unité,0,5,0,0,3,0,À définir,36.12,108.36
p195,cuieller de cafe  plastique 1000 pc (u),emporte&nettoyage,unité,0,1,0,0,1,0,À définir,36.00,36.00
p196,emport fourechet 50 pc (u),emporte&nettoyage,unité,0,20,0,0,20,0,À définir,12.00,240.00
p197,emport couteaux 100 pc (u),emporte&nettoyage,unité,0,10,1,0,9,0,À définir,24.00,216.00
p198,emport cuieller 100pc(u),emporte&nettoyage,unité,0,10,0,0,10,0,À définir,24.00,240.00
p199,paliyo berger peti pc(u),emporte&nettoyage,unité,0,8,1,0,0,0,À définir,37.13,0.00
p200,emport cafe normal 50(u),emporte&nettoyage,unité,0,6,1,0,4,0,À définir,24.00,96.00
p201,emport caf et the 50 (u),emporte&nettoyage,unité,0,6,1,0,5,0,À définir,37.50,187.50
p202,emport les jus 50(u),emporte&nettoyage,unité,0,20,0,0,20,0,À définir,34.50,690.00
p203,support vert 50 (u),emporte&nettoyage,unité,0,5,0,0,5,0,À définir,75.00,375.00
p204,support chaud 50 (u),emporte&nettoyage,unité,0,2,0,0,2,0,À définir,30.00,60.00
p205,emport pizza 50 (u),emporte&nettoyage,unité,0,2,0,0,1,0,À définir,84.00,84.00
p206,emport sac petit 250 pc (u),emporte&nettoyage,unité,0,2,0,0,2,0,À définir,350.01,700.02
p207,emport sac grand 250 pc(u) ,emporte&nettoyage,unité,0,1,0,0,1,0,À définir,712.56,712.56
p208,sachet frits 100 pc (u),emporte&nettoyage,unité,0,5,0,0,4,0,À définir,9.60,38.40
p209,les pay smouthie 100 pc (u),emporte&nettoyage,unité,0,8,1,0,7,0,À définir,19.00,133.00
p210,les pay  500 pc (u),emporte&nettoyage,unité,0,4,0,0,1,0,À définir,24.00,24.00
p211,emport boit sauc chaud trsp 50(u),emporte&nettoyage,unité,0,2,0,0,2,0,À définir,27.00,54.00
p212, rouleau de la caiss pc (u),emporte&nettoyage,unité,0,56,0,0,56,0,À définir,10.00,560.00
p213,rouleau de tpe 10 (u),emporte&nettoyage,unité,0,5,1,0,4,0,À définir,51.00,204.00
p214,rouleau tiktage  (u),emporte&nettoyage,unité,0,10,0,0,10,0,À définir,48.00,480.00
p215,mouchoirs (u),emporte&nettoyage,unité,0,5,0,0,5,0,À définir,8.34,41.70
p216,papier zizag 24 (u),emporte&nettoyage,unité,0,2,0,0,1,0,À définir,360.00,360.00
p217,papier serviett 25 (u),emporte&nettoyage,unité,0,7,,0,3,0,À définir,120.00,360.00
p218,bobines essuie-main (u),emporte&nettoyage,unité,0,12,4,0,1,0,À définir,36.00,36.00
p219,savan oni (u),emporte&nettoyage,unité,0,26,7,0,8,0,À définir,16.28,130.24
p220,javel 5l ,emporte&nettoyage,L,0,11,4,0,3,0,À définir,20.53,61.58
p221,grasafor 5l,emporte&nettoyage,L,0,4,1,0,5,0,À définir,120.00,600.00
p222,ajax 5l ,emporte&nettoyage,L,0,4,0,0,4,0,À définir,85.00,340.00
p223,halfa colour (u),emporte&nettoyage,unité,0,5,0,0,2,0,À définir,10.00,20.00
p224,halfa salk 25 (u),emporte&nettoyage,unité,0,5,0,0,4,0,À définir,32.40,129.60
p225,sac poubel larg 20 kg (u) ,emporte&nettoyage,unité,0,1,0,0,1,0,À définir,504.00,504.00
p226,sac poubel sml(u),emporte&nettoyage,unité,0,0,1,0,31,0,À définir,0.00,0.00
p227,plastique congélateur 1 pck (u),emporte&nettoyage,unité,0,20,0,0,11,0,À définir,18.21,200.28
p228,sanicroi 5l (u) ,emporte&nettoyage,unité,0,9,1,0,10,0,À définir,27.40,274.00
p229,eau minéral 33cl 12 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p230,eau minéral 50cl 12(u),eau&gazeuse,unité,0,0,2,0,-2,0,À définir,0.00,0.00
p231,oualmas 12 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p232,oualmas tropical 12 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p233,oualmas fruis roug 12(u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p234,coca zero 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p235,coca normal 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p236,hawai 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p237,poms 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p238,fanta orang 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p239,fanta citran 24 (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p240,sprait 24 (u) ,eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p241,shwips tonic 24 (u) ,eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p242,shwips citran 24 (u) ,eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p243,BOIT GAZ (u),eau&gazeuse,unité,0,0,0,0,0,0,À définir,0.00,0.00
p244,cure dent 1000 (u),emporte,unité,0,5,0,0,5,0,À définir,24.00,120.00
p245,cuieller jetables 100 pc (u),emporte,unité,0,2,0,0,2,0,À définir,75.00,150.00
p246,emport les pats petit 50 pc (u),emporte,unité,0,2,0,0,2,0,À définir,171.00,342.00
P247,EXTRA,SOKHRA,unité,0,2,0,0,2,0,À définir,293.04,586.09
P248,les moulle bouzog kg (u),poissons,kg,0,12,0,0,12,0,À définir,65.00,780.00
P249,poivre blanc kg (u),épices,kg,0,1,0,0,1,0,À définir,130.00,130.00
P250,ibzar hobob kg(u),épices,kg,0,1,0,0,1,0,À définir,100.00,100.00
P251,damat zaafrn 24 pc (u),épices,kg,0,3,0,0,3,0,À définir,96.00,288.00
P252,karfa 3wad kg (u),épices,kg,0,1,0,0,1,0,À définir,100.00,100.00
P253,vinaigre lemon (u),épices,unité,0,12,1,0,28,0,À définir,8.00,224.00
P254,sucre sanida 2 kg (u),0,unité,0,55,4,0,37,0,À définir,10.04,371.65
P255,sel 1dh ps (u),0,unité,0,30,0,0,30,0,À définir,1.30,39.00
P256,tmar kg (u),0,kg,0,4,0,0,4,0,À définir,35.00,140.00
P257,zbib kg (u) ,0,kg,0,5,0,0,5,0,À définir,48.00,240.00
P258,COLACAO (u),0,unité,0,6,1,0,2,0,À définir,21.67,43.33
P259,creme cuisson (u),0,unité,0,108,0,0,108,0,À définir,60.86,6573.12
P260,patte truff (u),0,unité,0,6,0,0,5,0,À définir,185.81,929.05
P261,chofan ps (u) ,0,unité,0,3,0,0,3,0,À définir,60.00,180.00
P262,granola blburry ps(u),0,unité,0,5,4,0,-1,0,À définir,53.32,-53.32
P263,FEUILL  ALUMINIUM,0,unité,0,500,0,0,500,0,À définir,0.66,330.00
P264,SERVIETTE NOIR  (u),0,unité,0,120,13,0,-10,0,À définir,19.45,-194.46
P265,gants hdpe (u),0,unité,0,4,0,0,4,0,À définir,7.65,30.60
P266,jfaf sfar,0,unité,0,5,0,0,5,0,À définir,11.40,57.00
P267,biberon larg (u) ,0,unité,0,10,0,0,10,0,À définir,25.00,250.00
P268,biberon petit,0,unité,0,10,0,0,10,0,À définir,21.00,210.00
P269,biberon moyen,0,unité,0,10,0,0,10,0,À définir,23.00,230.00
P270,frigona (u),0,unité,0,1,0,0,1,0,À définir,110.76,110.76
P271,knour poulet (u),0,unité,0,6,0,0,6,0,À définir,18.46,110.77
P272,knour viand (u),0,unité,0,5,0,0,5,0,À définir,7.00,35.00
P273,knour poisson (u),0,unité,0,6,0,0,6,0,À définir,18.58,111.45
P274,kharkom kg (u),0,unité,0,1,0,0,1,0,À définir,45.00,45.00
P275,amands efill,0,unité,0,3,0,0,3,0,À définir,120.00,360.00
P276,lentilles,0,unité,0,5,1,0,2,0,À définir,10.00,20.00
P277,harico blanc,0,unité,0,5,1,0,2,0,À définir,15.00,30.00
P278,ail podre (u),0,unité,0,4,0,0,3,0,À définir,90.00,270.00
P279,riz sfar,0,unité,0,5,0,0,1,0,À définir,12.00,12.00
P280,sman,0,unité,0,1,0,0,1,0,À définir,120.00,120.00
P281,miel 5kg (u),0,unité,0,2,0,0,2,0,À définir,65.00,130.00
P282,gingembr fri kg (u),0,unité,0,3,0,0,3,0,À définir,45.00,135.00
P283, nestle (u),0,unité,0,12,0,0,10,0,À définir,20.00,200.00
P284,sprait 2 l(u),0,unité,0,6,0,0,6,0,À définir,7.50,45.00
P285,kanze 10 kg (u),0,unité,0,2,0,0,2,0,À définir,60.20,120.40
P286,framboise ps(u),0,unité,0,0,0,0,0,0,À définir,0.00,0.00
P287,mini tortilla (u),0,unité,0,2,0,0,2,0,À définir,17.95,35.90
P288,tortilla (u),0,unité,0,2,0,0,2,0,À définir,15.90,31.80
P289,sauc guacamole (u),0,unité,0,1,0,0,1,0,À définir,90.00,90.00
P290,cornicho (u),0,unité,0,2,0,0,1,0,À définir,66.00,66.00
P291,olive noir 3kg (u),0,unité,0,3,0,0,3,0,À définir,73.33,219.99
P292,olive noir grand (u),0,unité,0,1,0,0,0,0,À définir,98.00,0.00
P293,sauc tomat pizza ps (u),0,unité,0,4,1,0,2,0,À définir,102.60,205.20
P294,aicha cnstr ps (u),0,unité,0,36,2,0,15,0,À définir,0.00,0.00
P295,sucre maro 1kg(u),0,unité,0,5,1,0,4,0,À définir,0.00,0.00
P296,viand kg(u),0,unité,0,2,0,0,2,0,À définir,130.00,260.00
p297,holala,0,unité,0,11,0,0,11,0,À définir,32.83,361.17
p298,calamar,0,unité,0,10,0,0,10,0,À définir,55.00,550.00
p299,sauman frai kg (u),Poissons & Fruits de mer,unité,0,3.6,0,0,3.6,0,À définir,290.00,1044.00
p300,pain burger petit (u),0,unité,0,60,0,0,60,0,À définir,2.50,150.00
p301,pain burger grand (u),0,unité,0,30,0,0,30,0,À définir,4.00,120.00
p302,pp  gineque,0,unité,0,0,3,0,25,0,À définir,0.00,0.00
p303,savan maine,0,unité,0,0,0,0,9,0,À définir,0.00,0.00
p304,sirop pina colda (u),0,unité,0,0,0,0,1,0,À définir,0.00,0.00
p305,sirop cane (u),0,unité,0,0,0,0,1,0,À définir,0.00,0.00
p306,sirop frise (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p307,sirop coco (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p308,sirop roman (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p309,pure frutta (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p310,lipton (u),0,0,0,0,1,0,1,0,À définir,0.00,0.00
p311,soltan (u),0,0,0,0,1,0,30,0,À définir,0.00,0.00
p312,cafe personal (u),0,0,0,0,1,0,39,0,À définir,0.00,0.00
p313,sucr cafe ps (u) ,0,0,0,0,6,0,12,0,À définir,0.00,0.00
p314,jus lipton (u),0,0,0,0,0,0,24,0,À définir,0.00,0.00
p315,paliyp burger grn ps (u),0,0,0,0,1,0,-1,0,À définir,0.00,0.00
p316,sessam noir (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p317,sessam blanc (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p318,demi glace,0,0,0,0,0,0,2,0,À définir,0.00,0.00
p319,damat ail 24 ps (u),0,0,0,0,0,0,22,0,À définir,0.00,0.00
p320,mayouniz (u),0,0,0,0,11,0,39,0,À définir,0.00,0.00
p321,ketchup mini (u),0,0,0,0,0,0,8,0,À définir,0.00,0.00
p322,tabasco (u),0,0,0,0,0,0,47,0,À définir,0.00,0.00
p323,hot sauc (u),0,0,0,0,0,0,9,0,À définir,0.00,0.00
p324,barbecu (u) ,0,0,0,0,2,0,42,0,À définir,0.00,0.00
p325,classic rips (u),0,0,0,0,0,0,3,0,À définir,0.00,0.00
p326,penne 10kg(u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p327,ola sauc (u),0,0,0,0,0,0,216,0,À définir,0.00,0.00
p328,chocolats noir (u),0,0,0,0,0,0,2,0,À définir,0.00,0.00
p329,beur biscui (u) ,0,0,0,0,1,0,10,0,À définir,0.00,0.00
p330,biscui (u),0,0,0,0,0,0,16,0,À définir,0.00,0.00
p331,panacota (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p332,huil paimente (u),0,0,0,0,0,0,1,0,À définir,0.00,0.00
p333,tabonaad,0,0,0,1,0,0,1,0,À définir,60.00,60.00
p334,origano,0,0,0,4,0,0,4,0,À définir,35.00,140.00
p335,rand,0,0,0,1,0,0,1,0,À définir,30.00,30.00
p336,boit dessert 100ps(u),0,0,0,2,0,0,2,0,À définir,144.00,288.00
p337,gant de menage,0,0,0,5,0,0,5,0,À définir,15.00,75.00
p338,asir l3inab,0,0,0,0,1,0,-1,0,À définir,0.00,0.00
p339,rips ps (u),0,0,0,5,27,0,-22,0,À définir,110.00,-2420.00
p340,sauman frai ps rs ,Poissons & Fruits de mer,0,0,26,0,0,26,0,À définir,0.00,0.00
p341,vianad hache  mini burger ps ,0,0,0,27,0,0,27,0,À définir,0.00,0.00
p342,viand hache burger ps ,0,0,0,37,0,0,37,0,À définir,0.00,0.00
p343,gamba rasion les patt (u),0,0,0,43,0,0,43,0,À définir,0.00,0.00
p344,calamar rasion ps  (u),0,0,0,7,0,0,7,0,À définir,0.00,0.00
p345,bolognaise rasoin (u) ,0,0,0,7,0,0,7,0,À définir,0.00,0.00`

export interface GoldenReferenceProductRow {
  rowNumber: number
  ref: string
  canonicalRef: string
  name: string
  category: string
  unit: string
  initialStock: number
  entrees: number
  sorties: number
  sortiesRawCell: string
  pertes: number
  stockFinal: number
  stockMinimumCell: string
  alerte: string
  prixMoyen: number
  valeurStock: number
}

export function parseGoldenReferenceRows(): GoldenReferenceProductRow[] {
  const lines = GOLDEN_REFERENCE_ETAT_STOCK_CSV.trim().split(/\r?\n/)
  const rows: GoldenReferenceProductRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const cols = line.split(',')
    const ref = cols[0] ?? ''
    rows.push({
      rowNumber: i + 1,
      ref,
      canonicalRef: ref.trim().toUpperCase(),
      name: cols[1] ?? '',
      category: cols[2] ?? '',
      unit: cols[3] ?? '',
      initialStock: Number(cols[4] || 0),
      entrees: Number(cols[5] || 0),
      sorties: cols[6] === '' ? 0 : Number(cols[6]),
      sortiesRawCell: cols[6] ?? '',
      pertes: Number(cols[7] || 0),
      stockFinal: Number(cols[8] || 0),
      stockMinimumCell: cols[9] ?? '',
      alerte: cols[10] ?? 'À définir',
      prixMoyen: Number(cols[11] || 0),
      valeurStock: Number(cols[12] || 0),
    })
  }
  return rows
}

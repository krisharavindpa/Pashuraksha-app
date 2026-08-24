"""Dummy Pashu Aadhaar registry, national scale.

Every animal in India's national livestock database is issued a 12-digit
"Pashu Aadhaar" (INAPH tag). This module is the demo stand-in for that
registry: it maps each 12-digit number to the animal's *owner* and its
*registered location*.

Three things depend on it:

1.  Auto-fill -- when a 12-digit number is typed into the report form, the
    frontend looks it up and pre-fills village / district / state / GPS so
    the farmer never types location data by hand.
2.  Ownership gating -- the lookup only succeeds for the owner. A farmer
    cannot pull up (or file a report against) another farmer's animal.
3.  The outbreak map -- district names and coordinates here are what the
    choropleth and the DBSCAN cluster bubbles are drawn from.

The `owner_id` values below are the same strings a user logs in with, so
signing in as `ravi_kumar` gives you exactly Ravi Kumar's animals.

Coverage
--------
`DISTRICT_ANCHORS` holds 239 districts across the 21 states that carry most
of India's livestock (20th Livestock Census weighting -- Uttar Pradesh,
Rajasthan, Madhya Pradesh, West Bengal, Bihar, Maharashtra, Andhra Pradesh,
Telangana, Karnataka, Gujarat, Tamil Nadu and the rest). Each district's
latitude/longitude is the **area-weighted centroid of that district's real
polygon** in `pashuraksha-app/public/maps/india.json`, the same geometry the
map renders. That is deliberate: it guarantees every generated homestead
falls inside the district it claims, so a report always lands in the right
patch of the choropleth and never in the sea or a neighbouring state.

Holdings rule
-------------
Exactly one owner in the registry holds more than 20 animals (see
`LARGE_HOLDER_ID`, a registered commercial dairy). Every other owner is
capped at 20. `_assert_holding_limits()` enforces this at import time.

Names, villages and tag numbers are synthetic. District and state names are
real, because they have to match the map.
"""

import random

SEED = 20260824
MAX_HOLDING = 20

# The single owner permitted to exceed MAX_HOLDING -- a registered commercial
# dairy rather than a smallholder, which is why it is the one exception.
LARGE_HOLDER_ID = "amrit_dairy_farm"
LARGE_HOLDER_SIZE = 26

SPECIES_MIX = (
    ("Cattle", 0.46),
    ("Buffalo", 0.24),
    ("Goat", 0.18),
    ("Sheep", 0.08),
    ("Pig", 0.04),
)

# Breeds are picked per species *and* per region, so a Punjab herd reads as a
# Punjab herd (Sahiwal, Nili-Ravi) rather than a generic Indian one.
BREEDS = {
    "North": {
        "Cattle": ["Sahiwal", "Hariana", "Rathi", "Tharparkar", "Holstein Friesian Cross"],
        "Buffalo": ["Murrah", "Nili-Ravi", "Bhadawari"],
        "Goat": ["Jamunapari", "Barbari", "Beetal"],
        "Sheep": ["Munjal", "Lohi", "Nali"],
        "Pig": ["Large White Yorkshire", "Landrace"],
    },
    "West": {
        "Cattle": ["Gir", "Kankrej", "Dangi", "Khillari", "Deoni"],
        "Buffalo": ["Mehsana", "Surti", "Jaffarabadi", "Pandharpuri", "Banni"],
        "Goat": ["Osmanabadi", "Sangamneri", "Zalawadi", "Kutchi"],
        "Sheep": ["Deccani", "Patanwadi", "Marwari"],
        "Pig": ["Landrace", "Ghungroo"],
    },
    "East": {
        "Cattle": ["Deshi", "Bachaur", "Purnea", "Binjharpuri", "Motu"],
        "Buffalo": ["Murrah", "Chilika", "Kalahandi"],
        "Goat": ["Black Bengal", "Ganjam", "Assam Hill"],
        "Sheep": ["Chotanagpuri", "Balangir", "Ganjam"],
        "Pig": ["Ghungroo", "Niang Megha", "Large Black"],
    },
    "Central": {
        "Cattle": ["Malvi", "Nimari", "Gaolao", "Kenkatha", "Sahiwal"],
        "Buffalo": ["Murrah", "Bhadawari", "Jerangi"],
        "Goat": ["Jamunapari", "Barbari", "Osmanabadi"],
        "Sheep": ["Deccani", "Malpura"],
        "Pig": ["Large White Yorkshire", "Landrace"],
    },
    "South": {
        "Cattle": ["Kangayam", "Hallikar", "Ongole", "Umblachery", "Vechur", "Jersey Cross"],
        "Buffalo": ["Toda", "Surti", "Murrah"],
        "Goat": ["Tellicherry", "Kanni Aadu", "Kodi Aadu", "Salem Black", "Osmanabadi"],
        "Sheep": ["Mecheri", "Madras Red", "Nellore", "Deccani"],
        "Pig": ["Large White Yorkshire", "Landrace"],
    },
}

# Which breed/name/village pool each state draws from.
REGION_OF_STATE = {
    "Punjab": "North", "Haryana": "North", "Uttar Pradesh": "North",
    "Uttarakhand": "North", "Himachal Pradesh": "North", "Jammu and Kashmir": "North",
    "Rajasthan": "West", "Gujarat": "West", "Maharashtra": "West",
    "Bihar": "East", "West Bengal": "East", "Odisha": "East",
    "Jharkhand": "East", "Assam": "East",
    "Madhya Pradesh": "Central", "Chhattisgarh": "Central",
    "Andhra Pradesh": "South", "Telangana": "South", "Karnataka": "South",
    "Tamil Nadu": "South", "Kerala": "South",
}

GIVEN_NAMES = {
    "North": ["Rajinder", "Harpreet", "Gurmeet", "Balwinder", "Sukhwinder", "Jaspal",
              "Ramesh", "Sunita", "Kamlesh", "Satpal", "Rajesh", "Anil", "Pushpa",
              "Devender", "Shakuntala", "Mahendra", "Om Prakash", "Krishna", "Bimla",
              "Jagdish", "Naresh", "Savitri", "Rakesh", "Yashpal", "Kiran"],
    "West": ["Bhagwan", "Vitthal", "Sunita", "Arjun", "Popatlal", "Hasmukh", "Jayantibhai",
             "Dashrath", "Kailash", "Mangala", "Sitaram", "Ramabai", "Prakash", "Nitin",
             "Chhaganbhai", "Dinesh", "Rekha", "Shantaben", "Bharat", "Kishor",
             "Ganpat", "Ashok", "Vasant", "Meera", "Ravindra"],
    "East": ["Prabhat", "Sushil", "Ranjit", "Bimal", "Nikhil", "Sanjay", "Anima",
             "Debabrata", "Ashok", "Rina", "Manoj", "Ratan", "Jyotsna", "Biswajit",
             "Ramprasad", "Kalpana", "Dilip", "Naba", "Chandan", "Sabita",
             "Tapan", "Hemant", "Malati", "Nirmal", "Pradip"],
    "Central": ["Ramlal", "Shivnarayan", "Dinesh", "Phoolwati", "Ghanshyam", "Kamla",
                "Devilal", "Santosh", "Bhagirath", "Prem", "Rukmini", "Hariram",
                "Mukesh", "Sarita", "Jagdish", "Lakhan", "Radheshyam", "Sushila",
                "Chandrabhan", "Nathuram", "Girija", "Bansilal", "Umesh", "Kaushalya", "Munna"],
    "South": ["Murugan", "Lakshmi", "Karthik", "Anitha", "Suresh", "Bhavani", "Ravi",
              "Selvi", "Venkatesh", "Padma", "Ramesh", "Kavitha", "Nagaraj", "Shanthi",
              "Ganesan", "Vasantha", "Srinivas", "Manjula", "Perumal", "Rajeshwari",
              "Chandrappa", "Yellamma", "Basavaraj", "Subramani", "Gowri"],
}

SURNAMES = {
    "North": ["Singh", "Sharma", "Yadav", "Verma", "Chaudhary", "Kaur", "Gill", "Sandhu",
              "Rana", "Tomar", "Kashyap", "Saini", "Dhillon", "Nain", "Panwar", "Thakur"],
    "West": ["Patil", "Patel", "More", "Jadhav", "Desai", "Solanki", "Chavan", "Rathod",
             "Shinde", "Parmar", "Gaikwad", "Bhosale", "Vaghela", "Kadam", "Choudhary", "Deshmukh"],
    "East": ["Das", "Ghosh", "Mandal", "Roy", "Sahu", "Nayak", "Mahato", "Pradhan",
             "Bhuyan", "Sarkar", "Barman", "Hembram", "Oraon", "Behera", "Paul", "Baruah"],
    "Central": ["Patel", "Yadav", "Sahu", "Verma", "Lodhi", "Rajput", "Kushwaha", "Dhurve",
                "Uikey", "Gurjar", "Jat", "Ahirwar", "Vishwakarma", "Tiwari", "Netam", "Sori"],
    "South": ["Gowda", "Reddy", "Naidu", "Rao", "Shetty", "Nair", "Pillai", "Murthy",
              "Swamy", "Chetty", "Hegde", "Kumar", "Raju", "Setty", "Shaikh", "Bhat"],
}

# Village-name pools. Synthetic, but built from real regional morphology, so a
# Tamil Nadu village reads Tamil and a Punjab one reads Punjabi.
VILLAGES = {
    "North": ["Rampura", "Bhagwanpur", "Kotla", "Dhanaula", "Jhandewala", "Nathupur",
              "Sohana", "Bhikhiwind", "Chak Sahibu", "Manakpur", "Raiwala", "Ghanauli",
              "Sultanpur Lodhi", "Nawanshahr", "Bhattian", "Dera Bassi", "Salempur",
              "Jhinjhana", "Palri", "Barwala", "Sisai", "Kheri Sadh", "Madina", "Gharaunda"],
    "West": ["Wadgaon", "Pimpalgaon", "Shirala", "Kasegaon", "Nandgaon", "Bhilwadi",
             "Anjar", "Vadnagar", "Dhandhuka", "Bhachau", "Lakhtar", "Sanand",
             "Deolali", "Chikhli", "Talegaon", "Vadgaon", "Umreth", "Radhanpur",
             "Kalol", "Kheralu", "Savli", "Kadi", "Sidhpur", "Mundra"],
    "East": ["Bishnupur", "Krishnanagar", "Baruipur", "Simulia", "Ranihati", "Habra",
             "Dhaniakhali", "Manikpur", "Sonapur", "Balipara", "Barpeta Road",
             "Jagatpur", "Kendrapada", "Nilagiri", "Bhawanipatna", "Rajgir",
             "Bihta", "Barh", "Hilsa", "Dumraon", "Nawada Bazar", "Gopalpur",
             "Chandil", "Bundu"],
    "Central": ["Sirmour", "Amarpatan", "Maihar", "Gadarwara", "Sohagpur", "Multai",
                "Pandhurna", "Barghat", "Baihar", "Katangi", "Sanawad", "Bagli",
                "Khategaon", "Kurwai", "Sironj", "Ashta", "Berasia", "Pichhore",
                "Dabra", "Bhanupratappur", "Kurud", "Arang", "Palari", "Basna"],
    "South": ["Perundurai", "Sankagiri", "Rasipuram", "Palladam", "Kaveripattinam",
              "Thirupathur", "Vandavasi", "Ulundurpet", "Melur", "Natham",
              "Budhikote", "Sidlaghatta", "Nagamangala", "Malur", "Aland",
              "Sindhanur", "Hungund", "Palamaner", "Pamidi", "Bethamcherla",
              "Devarakonda", "Bhongir", "Jammikunta", "Armoor"],
}

# (state, district, latitude, longitude, clearance_deg)
#
# lat/lng is the district's *pole of inaccessibility* -- the interior point
# furthest from any boundary -- computed from that district's real polygon in
# public/maps/india.json. A plain centroid is not safe here: a concave district
# (Srinagar, Dhubri) has a centroid that lies outside its own borders, which
# would drop a herd into the wrong district or into water.
#
# clearance_deg is the distance from that point to the nearest boundary, and is
# what bounds the random scatter below, so a generated homestead can never
# escape the district it claims. See _jitter_limits().
DISTRICT_ANCHORS = [
    # --- Uttar Pradesh
    ("Uttar Pradesh", "Mathura", 27.6357, 77.5802, 0.2286),
    ("Uttar Pradesh", "Aligarh", 27.9117, 78.2458, 0.1776),
    ("Uttar Pradesh", "Agra", 27.0842, 77.9999, 0.1945),
    ("Uttar Pradesh", "Bareilly", 28.4417, 79.4420, 0.2683),
    ("Uttar Pradesh", "Sitapur", 27.4957, 80.8060, 0.2940),
    ("Uttar Pradesh", "Hardoi", 27.4161, 80.0477, 0.2969),
    ("Uttar Pradesh", "Lakhimpur Kheri", 28.1898, 80.6858, 0.3536),
    ("Uttar Pradesh", "Gorakhpur", 26.6838, 83.3514, 0.2395),
    ("Uttar Pradesh", "Azamgarh", 26.0112, 83.0311, 0.2704),
    ("Uttar Pradesh", "Jaunpur", 25.7423, 82.5336, 0.2406),
    ("Uttar Pradesh", "Prayagraj", 25.3106, 81.9199, 0.2911),
    ("Uttar Pradesh", "Varanasi", 25.4005, 82.8588, 0.1540),
    ("Uttar Pradesh", "Meerut", 29.0147, 77.8703, 0.1852),
    ("Uttar Pradesh", "Muzaffarnagar", 29.4065, 77.7920, 0.2092),
    ("Uttar Pradesh", "Bulandshahr", 28.3899, 77.9913, 0.2591),
    ("Uttar Pradesh", "Etawah", 26.8078, 79.1404, 0.1910),
    ("Uttar Pradesh", "Jhansi", 25.5784, 79.1451, 0.2203),
    ("Uttar Pradesh", "Sultanpur", 26.2312, 82.2079, 0.1777),
    ("Uttar Pradesh", "Barabanki", 26.9567, 81.3218, 0.2297),
    ("Uttar Pradesh", "Bahraich", 27.6269, 81.4800, 0.2041),
    ("Uttar Pradesh", "Moradabad", 29.0090, 78.7514, 0.1517),
    ("Uttar Pradesh", "Shahjahanpur", 27.9350, 79.7892, 0.2228),
    # --- Rajasthan
    ("Rajasthan", "Barmer", 25.5878, 71.3139, 0.6090),
    ("Rajasthan", "Jodhpur", 26.8057, 72.6165, 0.5205),
    ("Rajasthan", "Nagaur", 26.9367, 74.1354, 0.4864),
    ("Rajasthan", "Bikaner", 28.1131, 73.2831, 0.6707),
    ("Rajasthan", "Jaipur", 26.9055, 75.6889, 0.4040),
    ("Rajasthan", "Alwar", 27.5288, 76.5884, 0.3542),
    ("Rajasthan", "Udaipur", 24.3851, 73.8599, 0.4037),
    ("Rajasthan", "Bhilwara", 25.5457, 74.5459, 0.3649),
    ("Rajasthan", "Ajmer", 26.2628, 74.7657, 0.3465),
    ("Rajasthan", "Pali", 25.6705, 73.4481, 0.3844),
    ("Rajasthan", "Jaisalmer", 26.9961, 70.7466, 0.7230),
    ("Rajasthan", "Churu", 28.4701, 74.6529, 0.3657),
    ("Rajasthan", "Sikar", 27.6222, 75.0474, 0.2551),
    ("Rajasthan", "Ganganagar", 29.3885, 73.5884, 0.3548),
    ("Rajasthan", "Chittorgarh", 24.7933, 74.5024, 0.2986),
    ("Rajasthan", "Banswara", 23.4507, 74.3145, 0.2485),
    # --- Madhya Pradesh
    ("Madhya Pradesh", "Betul", 21.8791, 77.9200, 0.4152),
    ("Madhya Pradesh", "Chhindwara", 22.0818, 78.9208, 0.4257),
    ("Madhya Pradesh", "Sagar", 23.8585, 78.7613, 0.3237),
    ("Madhya Pradesh", "Rewa", 24.7761, 81.4860, 0.3364),
    ("Madhya Pradesh", "Satna", 24.5469, 80.8115, 0.3443),
    ("Madhya Pradesh", "Jabalpur", 23.3247, 80.0219, 0.2540),
    ("Madhya Pradesh", "Ujjain", 23.3508, 75.6959, 0.2776),
    ("Madhya Pradesh", "Dhar", 22.4814, 75.1572, 0.3741),
    ("Madhya Pradesh", "Khargone", 21.8887, 75.7392, 0.3633),
    ("Madhya Pradesh", "Balaghat", 21.9334, 80.3993, 0.3410),
    ("Madhya Pradesh", "Shivpuri", 25.3894, 77.7772, 0.3908),
    ("Madhya Pradesh", "Guna", 24.7177, 77.2683, 0.2301),
    ("Madhya Pradesh", "Vidisha", 24.0066, 77.7574, 0.3008),
    ("Madhya Pradesh", "Mandsaur", 24.0652, 75.2199, 0.2418),
    ("Madhya Pradesh", "Seoni", 22.3510, 79.6915, 0.3714),
    ("Madhya Pradesh", "Damoh", 23.8666, 79.5344, 0.2907),
    # --- West Bengal
    ("West Bengal", "Murshidabad", 24.1351, 88.2657, 0.2849),
    ("West Bengal", "Nadia", 23.3676, 88.5460, 0.1914),
    ("West Bengal", "Purba Bardhaman", 23.2916, 87.9341, 0.2716),
    ("West Bengal", "Bankura", 23.2057, 87.1261, 0.3286),
    ("West Bengal", "Purulia", 23.2450, 86.4985, 0.2501),
    ("West Bengal", "Birbhum", 23.8436, 87.6232, 0.2267),
    ("West Bengal", "Cooch Behar", 26.2492, 89.4105, 0.2141),
    ("West Bengal", "Malda", 25.0982, 88.0898, 0.1838),
    ("West Bengal", "North 24 Parganas", 22.7430, 88.7216, 0.1891),
    ("West Bengal", "South 24 Parganas", 22.2249, 88.4911, 0.2982),
    ("West Bengal", "Paschim Medinipur", 22.6076, 87.4002, 0.3002),
    ("West Bengal", "Jalpaiguri", 26.6608, 88.7357, 0.2569),
    # --- Bihar
    ("Bihar", "Muzaffarpur", 26.1143, 85.5036, 0.1919),
    ("Bihar", "Samastipur", 25.8271, 85.8086, 0.1857),
    ("Bihar", "Madhubani", 26.3862, 86.3324, 0.2115),
    ("Bihar", "Darbhanga", 26.0485, 86.1769, 0.1590),
    ("Bihar", "East Champaran", 26.5938, 84.9409, 0.2604),
    ("Bihar", "West Champaran", 27.0863, 84.3470, 0.2936),
    ("Bihar", "Patna", 25.4897, 84.9954, 0.1986),
    ("Bihar", "Gaya", 24.7190, 85.0079, 0.2749),
    ("Bihar", "Purnia", 25.8319, 87.4278, 0.1566),
    ("Bihar", "Katihar", 25.5037, 87.6073, 0.1777),
    ("Bihar", "Saran", 25.8969, 84.7893, 0.1947),
    ("Bihar", "Rohtas", 25.0208, 84.0393, 0.2031),
    ("Bihar", "Begusarai", 25.5237, 86.0911, 0.1673),
    ("Bihar", "Sitamarhi", 26.5728, 85.5731, 0.1809),
    # --- Maharashtra
    ("Maharashtra", "Ahmednagar", 19.3393, 74.5956, 0.3981),
    ("Maharashtra", "Solapur", 17.7825, 75.4398, 0.3616),
    ("Maharashtra", "Pune", 18.6429, 73.8732, 0.4849),
    ("Maharashtra", "Nashik", 20.1705, 73.9258, 0.4331),
    ("Maharashtra", "Jalgaon", 20.9947, 75.5018, 0.3900),
    ("Maharashtra", "Kolhapur", 16.6565, 74.0958, 0.2418),
    ("Maharashtra", "Sangli", 17.1169, 74.6171, 0.2849),
    ("Maharashtra", "Satara", 17.7372, 74.0868, 0.3725),
    ("Maharashtra", "Beed", 18.9611, 76.0640, 0.3413),
    ("Maharashtra", "Latur", 18.3433, 76.6687, 0.3200),
    ("Maharashtra", "Osmanabad", 17.9472, 76.1829, 0.1880),
    ("Maharashtra", "Nanded", 18.9124, 77.4707, 0.3568),
    ("Maharashtra", "Yavatmal", 20.2561, 78.1218, 0.3516),
    ("Maharashtra", "Amravati", 21.0843, 77.7623, 0.3218),
    ("Maharashtra", "Buldhana", 20.6070, 76.3773, 0.3455),
    ("Maharashtra", "Aurangabad", 19.9643, 75.2131, 0.3789),
    # --- Andhra Pradesh
    ("Andhra Pradesh", "Anantapur", 14.7438, 77.5555, 0.4319),
    ("Andhra Pradesh", "Kurnool", 15.4830, 78.3528, 0.4140),
    ("Andhra Pradesh", "Chittoor", 13.4950, 78.9181, 0.3972),
    ("Andhra Pradesh", "Y.S.R. Kadapa", 14.3357, 78.8542, 0.4363),
    ("Andhra Pradesh", "Guntur", 16.3421, 80.2026, 0.2813),
    ("Andhra Pradesh", "Prakasam", 15.6123, 79.2375, 0.4649),
    ("Andhra Pradesh", "Krishna", 16.6744, 80.7631, 0.2142),
    ("Andhra Pradesh", "East Godavari", 17.2770, 82.0378, 0.3565),
    ("Andhra Pradesh", "West Godavari", 16.9996, 81.3867, 0.3146),
    ("Andhra Pradesh", "S.P.S. Nellore", 14.5275, 79.7512, 0.4156),
    # --- Telangana
    ("Telangana", "Mahabubnagar", 16.7881, 78.0410, 0.1815),
    ("Telangana", "Nalgonda", 16.9156, 79.2501, 0.3490),
    ("Telangana", "Warangal Rural", 17.9564, 79.8233, 0.1641),
    ("Telangana", "Khammam", 17.2262, 80.3039, 0.2338),
    ("Telangana", "Karimnagar", 18.3058, 79.3250, 0.1458),
    ("Telangana", "Nizamabad", 18.7156, 78.2408, 0.2464),
    ("Telangana", "Medak", 17.9418, 78.3049, 0.1980),
    ("Telangana", "Adilabad", 19.5545, 78.5674, 0.2585),
    ("Telangana", "Suryapet", 16.9453, 79.8388, 0.2002),
    ("Telangana", "Siddipet", 18.0119, 78.7682, 0.2091),
    # --- Karnataka
    ("Karnataka", "Belagavi", 16.0037, 74.8347, 0.3729),
    ("Karnataka", "Tumakuru", 13.4058, 76.8258, 0.3750),
    ("Karnataka", "Mysuru", 12.2005, 76.4164, 0.2663),
    ("Karnataka", "Mandya", 12.6338, 76.7281, 0.2580),
    ("Karnataka", "Hassan", 12.9989, 76.1390, 0.2900),
    ("Karnataka", "Kalaburagi", 17.2715, 76.7701, 0.3891),
    ("Karnataka", "Ballari", 14.9630, 76.4030, 0.2826),
    ("Karnataka", "Vijayapura", 16.7267, 75.9731, 0.3981),
    ("Karnataka", "Bagalkote", 16.1005, 75.6900, 0.2514),
    ("Karnataka", "Chitradurga", 14.0844, 76.4333, 0.3434),
    ("Karnataka", "Davanagere", 14.3045, 75.8537, 0.2119),
    ("Karnataka", "Kolar", 13.0672, 78.1696, 0.2225),
    ("Karnataka", "Bidar", 17.9319, 77.2678, 0.2986),
    ("Karnataka", "Raichur", 16.0398, 76.7453, 0.3380),
    # --- Gujarat
    ("Gujarat", "Banaskantha", 24.3102, 71.8038, 0.3564),
    ("Gujarat", "Kutch", 23.5506, 69.3817, 0.7095),
    ("Gujarat", "Sabarkantha", 23.8333, 72.9742, 0.1761),
    ("Gujarat", "Mehsana", 23.7288, 72.5292, 0.1968),
    ("Gujarat", "Rajkot", 22.0916, 70.8605, 0.2763),
    ("Gujarat", "Junagadh", 21.3175, 70.2760, 0.2736),
    ("Gujarat", "Amreli", 21.3751, 71.2184, 0.2810),
    ("Gujarat", "Bhavnagar", 21.5935, 71.9053, 0.3284),
    ("Gujarat", "Surendranagar", 22.7212, 71.6018, 0.3668),
    ("Gujarat", "Patan", 23.7044, 71.5872, 0.2077),
    ("Gujarat", "Anand", 22.4435, 72.8926, 0.1514),
    ("Gujarat", "Kheda", 22.9116, 73.0194, 0.1872),
    ("Gujarat", "Jamnagar", 22.2529, 70.1073, 0.2960),
    ("Gujarat", "Dahod", 22.8562, 74.1272, 0.2524),
    # --- Tamil Nadu
    ("Tamil Nadu", "Erode", 11.5415, 77.3895, 0.2293),
    ("Tamil Nadu", "Salem", 11.7368, 78.1040, 0.2046),
    ("Tamil Nadu", "Namakkal", 11.3171, 78.2002, 0.2249),
    ("Tamil Nadu", "Coimbatore", 11.1110, 76.9601, 0.2083),
    ("Tamil Nadu", "Dharmapuri", 12.1570, 78.0618, 0.2103),
    ("Tamil Nadu", "Krishnagiri", 12.5076, 77.8149, 0.1795),
    ("Tamil Nadu", "Vellore", 12.9008, 78.9652, 0.1832),
    ("Tamil Nadu", "Tiruvannamalai", 12.3219, 78.9866, 0.2546),
    ("Tamil Nadu", "Viluppuram", 12.1081, 79.5479, 0.2482),
    ("Tamil Nadu", "Madurai", 9.8564, 77.8801, 0.2146),
    ("Tamil Nadu", "Dindigul", 10.3905, 77.8445, 0.2703),
    ("Tamil Nadu", "Thanjavur", 10.4391, 79.2979, 0.1511),
    ("Tamil Nadu", "Tiruppur", 10.8893, 77.5125, 0.2189),
    ("Tamil Nadu", "Sivaganga", 9.7869, 78.5292, 0.1955),
    ("Tamil Nadu", "Chengalpattu", 12.4524, 79.9372, 0.1803),
    ("Tamil Nadu", "Kancheepuram", 12.8581, 79.7805, 0.1161),
    # --- Punjab
    ("Punjab", "Ludhiana", 30.7732, 75.5916, 0.1958),
    ("Punjab", "Patiala", 30.3015, 76.3380, 0.1713),
    ("Punjab", "Sangrur", 30.1205, 75.8593, 0.2007),
    ("Punjab", "Bathinda", 30.1595, 75.0267, 0.2318),
    ("Punjab", "Ferozepur", 30.9630, 74.8157, 0.1531),
    ("Punjab", "Amritsar", 31.7570, 74.7707, 0.1874),
    ("Punjab", "Gurdaspur", 31.9078, 75.3209, 0.2108),
    ("Punjab", "Jalandhar", 31.1347, 75.5850, 0.1602),
    ("Punjab", "Moga", 30.7793, 75.1903, 0.2010),
    ("Punjab", "Sri Muktsar Sahib", 30.3218, 74.5315, 0.1914),
    # --- Haryana
    ("Haryana", "Hisar", 29.2520, 75.8214, 0.2385),
    ("Haryana", "Bhiwani", 28.8538, 76.0377, 0.1914),
    ("Haryana", "Sirsa", 29.6548, 74.8620, 0.2520),
    ("Haryana", "Jind", 29.3449, 76.3907, 0.1807),
    ("Haryana", "Rohtak", 28.9213, 76.5105, 0.1592),
    ("Haryana", "Karnal", 29.6871, 76.9173, 0.1960),
    ("Haryana", "Kaithal", 29.7459, 76.4107, 0.1759),
    ("Haryana", "Fatehabad", 29.5628, 75.5063, 0.1915),
    ("Haryana", "Sonipat", 29.0050, 76.9677, 0.1839),
    ("Haryana", "Mahendragarh", 28.2875, 76.1918, 0.1515),
    # --- Odisha
    ("Odisha", "Ganjam", 19.5598, 84.7434, 0.3402),
    ("Odisha", "Mayurbhanj", 21.9044, 86.3898, 0.4137),
    ("Odisha", "Balasore", 21.4099, 86.7415, 0.1892),
    ("Odisha", "Cuttack", 20.5128, 85.9148, 0.1427),
    ("Odisha", "Kalahandi", 19.8674, 83.0963, 0.3053),
    ("Odisha", "Sundargarh", 22.0433, 84.7759, 0.2642),
    ("Odisha", "Balangir", 20.5288, 83.0644, 0.3222),
    ("Odisha", "Koraput", 18.8145, 82.6882, 0.3503),
    ("Odisha", "Kendujhar", 21.5036, 85.6713, 0.3356),
    ("Odisha", "Puri", 19.9642, 85.8114, 0.1668),
    # --- Assam
    ("Assam", "Nagaon", 26.3787, 92.7146, 0.1514),
    ("Assam", "Barpeta", 26.3408, 91.0280, 0.1872),
    ("Assam", "Kamrup", 26.0010, 91.2712, 0.1719),
    ("Assam", "Sonitpur", 26.7758, 92.7083, 0.2290),
    ("Assam", "Dhubri", 26.0440, 89.9271, 0.0885),
    ("Assam", "Darrang", 26.4077, 91.9538, 0.1361),
    ("Assam", "Cachar", 24.8170, 92.8703, 0.2332),
    ("Assam", "Sivasagar", 26.9549, 94.6051, 0.1312),
    ("Assam", "Jorhat", 26.7374, 94.2515, 0.1787),
    ("Assam", "Golaghat", 26.5711, 93.9217, 0.1753),
    # --- Jharkhand
    ("Jharkhand", "Ranchi", 23.4450, 85.1277, 0.1908),
    ("Jharkhand", "Palamu", 24.1860, 84.2145, 0.2391),
    ("Jharkhand", "Hazaribagh", 24.1009, 85.4632, 0.2234),
    ("Jharkhand", "Giridih", 24.2157, 86.1354, 0.2876),
    ("Jharkhand", "Dhanbad", 23.8302, 86.5020, 0.1709),
    ("Jharkhand", "Dumka", 24.2761, 87.2852, 0.2451),
    ("Jharkhand", "Bokaro", 23.7082, 85.9646, 0.1847),
    ("Jharkhand", "Gumla", 23.0434, 84.6326, 0.2618),
    # --- Chhattisgarh
    ("Chhattisgarh", "Raipur", 21.2924, 81.8224, 0.2144),
    ("Chhattisgarh", "Bilaspur", 22.6592, 81.9671, 0.2030),
    ("Chhattisgarh", "Durg", 21.2148, 81.3718, 0.1727),
    ("Chhattisgarh", "Bastar", 19.0725, 81.8952, 0.2963),
    ("Chhattisgarh", "Raigarh", 22.2581, 83.3474, 0.2707),
    ("Chhattisgarh", "Surguja", 22.9891, 83.2633, 0.2049),
    ("Chhattisgarh", "Rajnandgaon", 21.2637, 80.9064, 0.2481),
    ("Chhattisgarh", "Janjgir Champa", 21.9245, 82.8076, 0.2007),
    # --- Kerala
    ("Kerala", "Palakkad", 10.6879, 76.6584, 0.2005),
    ("Kerala", "Thrissur", 10.4962, 76.2540, 0.1869),
    ("Kerala", "Malappuram", 11.1136, 76.1432, 0.2012),
    ("Kerala", "Kollam", 8.9652, 76.9411, 0.1617),
    ("Kerala", "Thiruvananthapuram", 8.5857, 77.0557, 0.1787),
    ("Kerala", "Kottayam", 9.6549, 76.6588, 0.1766),
    ("Kerala", "Idukki", 9.9170, 76.9957, 0.2201),
    ("Kerala", "Ernakulam", 10.0621, 76.5082, 0.2206),
    # --- Uttarakhand
    ("Uttarakhand", "Udham Singh Nagar", 28.8967, 79.9573, 0.1120),
    ("Uttarakhand", "Haridwar", 29.9070, 77.9329, 0.1922),
    ("Uttarakhand", "Dehradun", 30.7280, 77.8992, 0.1523),
    ("Uttarakhand", "Nainital", 29.2895, 79.5627, 0.2221),
    ("Uttarakhand", "Pauri Garhwal", 29.8695, 78.7804, 0.3049),
    # --- Himachal Pradesh
    ("Himachal Pradesh", "Kangra", 32.0465, 76.2580, 0.2698),
    ("Himachal Pradesh", "Mandi", 31.6006, 76.9960, 0.2500),
    ("Himachal Pradesh", "Shimla", 31.1204, 77.6033, 0.2436),
    ("Himachal Pradesh", "Solan", 31.0609, 76.8561, 0.1714),
    ("Himachal Pradesh", "Hamirpur", 31.6819, 76.5172, 0.1372),
    # --- Jammu and Kashmir
    ("Jammu and Kashmir", "Jammu", 32.7843, 74.8175, 0.1564),
    ("Jammu and Kashmir", "Anantnag", 33.6812, 75.3085, 0.1957),
    ("Jammu and Kashmir", "Baramulla", 34.1616, 74.3715, 0.1864),
    ("Jammu and Kashmir", "Srinagar", 34.1185, 74.9434, 0.0686),
    ("Jammu and Kashmir", "Kathua", 32.5754, 75.5801, 0.1924),
]


# Legacy demo owners. These predate the national dataset and are kept verbatim
# because the login screen and the docs hand them out as sample credentials --
# renumbering them would invalidate every Pashu Aadhaar printed in the README.
# (owner_id, name, village, district, state, lat, lng, herd_size)
LEGACY_OWNERS = [
    ("farmer_01", "Demo Farmer", "Maraimalai Nagar", "Chengalpattu", "Tamil Nadu", 12.7925, 80.0248, 4),
    ("ravi_kumar", "Ravi Kumar", "Guduvancheri", "Chengalpattu", "Tamil Nadu", 12.8449, 80.0587, 5),
    ("lakshmi_devi", "Lakshmi Devi", "Singaperumal Koil", "Chengalpattu", "Tamil Nadu", 12.7568, 80.0090, 4),
    ("murugan_s", "Murugan S", "Uthiramerur", "Kancheepuram", "Tamil Nadu", 12.6100, 79.7600, 5),
    ("anitha_r", "Anitha R", "Gudiyatham", "Vellore", "Tamil Nadu", 12.9470, 78.8700, 4),
    ("karthik_m", "Karthik M", "Bhavani", "Erode", "Tamil Nadu", 11.4450, 77.6800, 4),
    ("suresh_gowda", "Suresh Gowda", "Maddur", "Mandya", "Karnataka", 12.5847, 77.0450, 5),
    ("bhavani_n", "Bhavani N", "Malavalli", "Mandya", "Karnataka", 12.3833, 77.0667, 4),
    ("iqbal_shaikh", "Iqbal Shaikh", "Gokak", "Belagavi", "Karnataka", 16.1667, 74.8333, 4),
    ("sunita_patil", "Sunita Patil", "Sangamner", "Ahmednagar", "Maharashtra", 19.5700, 74.2100, 5),
    ("arjun_more", "Arjun More", "Ichalkaranji", "Kolhapur", "Maharashtra", 16.7000, 74.4700, 4),
]


def is_valid_pashu_aadhaar(value) -> bool:
    """Format check only: exactly 12 digits.

    Deliberately no checksum. Real INAPH tags publish no check scheme, and a
    synthetic one would mean a plausible hand-typed number got rejected as
    "malformed" instead of the far more useful "not in the registry". The
    registry lookup is the real gate; ownership is the one after that.
    """
    return isinstance(value, str) and value.isdigit() and len(value) == 12


def _make_aadhaar(state_code: int, owner_idx: int, animal_idx: int, serial: int) -> str:
    """Build a structured, unique 12-digit tag.

    Layout: SS OOO AA NNNNN
      SS    state code (2)  -- a tag hints at where the animal is registered
      OOO   owner index (3)
      AA    animal index within that owner (2)
      NNNNN global running serial (5) -- what actually guarantees uniqueness
    """
    return f"{state_code:02d}{owner_idx + 1:03d}{animal_idx + 1:02d}{serial % 100000:05d}"


# Stable 2-digit code per state, assigned by sorted state name so the mapping
# never shifts when a district is added.
_STATE_CODES = {
    name: idx + 10
    for idx, name in enumerate(sorted({a[0] for a in DISTRICT_ANCHORS}))
}
_STATE_CODES.setdefault("Tamil Nadu", _STATE_CODES.get("Tamil Nadu", 30))


def _slug(name: str) -> str:
    return "".join(c.lower() if c.isalnum() else "_" for c in name).strip("_")


def _pick_species(rng) -> str:
    roll = rng.random()
    cumulative = 0.0
    for species, weight in SPECIES_MIX:
        cumulative += weight
        if roll <= cumulative:
            return species
    return SPECIES_MIX[0][0]


# Random scatter, in degrees, applied to a homestead and then to each animal
# around it. Both are bounded by the district's boundary clearance so a herd
# always lands inside the district its record names.
OWNER_JITTER = 0.045     # ~5 km
ANIMAL_JITTER = 0.005    # ~550 m
_CLEARANCE_MARGIN = 0.008


def _jitter_limits(clearance: float):
    """Per-axis jitter that keeps the worst-case diagonal inside the district.

    Offsets are drawn independently per axis, so the furthest a point can land
    is the diagonal sqrt(2) * limit, not the limit itself -- hence dividing the
    usable clearance by 1.5 rather than using it whole.
    """
    usable = max(clearance - _CLEARANCE_MARGIN, 0.004)
    owner = min(OWNER_JITTER, usable / 1.5)
    animal = min(ANIMAL_JITTER, owner / 4)
    return owner, animal


def _build_owners():
    """One smallholder per anchor district, plus the legacy demo owners.

    Owner names are drawn from the region's pool and de-duplicated globally,
    so "one name = one farmer id = one holding" holds. That matters because the
    >20 rule is stated per person, and two farmers sharing a display name would
    make the rule unverifiable by eye.
    """
    rng = random.Random(SEED)
    owners = {}
    used_names = set()

    for owner_id, name, village, district, state, lat, lng, _count in LEGACY_OWNERS:
        owners[owner_id] = {
            "name": name, "village": village, "district": district,
            "state": state, "lat": lat, "lng": lng,
            "animal_jitter": ANIMAL_JITTER,
        }
        used_names.add(name)

    for idx, (state, district, lat, lng, clearance) in enumerate(DISTRICT_ANCHORS):
        region = REGION_OF_STATE[state]

        # Re-draw until the display name is globally unique. The pools are far
        # larger than the per-region draw count, so this converges immediately;
        # the counter is a hard stop rather than an expected path.
        name = None
        for _ in range(200):
            candidate = f"{rng.choice(GIVEN_NAMES[region])} {rng.choice(SURNAMES[region])}"
            if candidate not in used_names:
                name = candidate
                break
        if name is None:
            name = f"{rng.choice(GIVEN_NAMES[region])} {rng.choice(SURNAMES[region])} {idx}"
        used_names.add(name)

        owner_id = _slug(name)
        if owner_id in owners:
            owner_id = f"{owner_id}_{idx}"

        # Scatter the homestead off the district's interior point so herds in
        # the same district are distinguishable instead of stacked on one spot.
        owner_jitter, animal_jitter = _jitter_limits(clearance)
        owners[owner_id] = {
            "name": name,
            "village": rng.choice(VILLAGES[region]),
            "district": district,
            "state": state,
            "lat": round(lat + rng.uniform(-owner_jitter, owner_jitter), 6),
            "lng": round(lng + rng.uniform(-owner_jitter, owner_jitter), 6),
            "animal_jitter": animal_jitter,
        }

    # The one permitted large holder, placed in Punjab's dairy belt.
    owners[LARGE_HOLDER_ID] = {
        "name": "Amrit Dairy Farm (Balwant Singh Gill)",
        "village": "Bhattian",
        "district": "Ludhiana",
        "state": "Punjab",
        "lat": 30.8412,
        "lng": 75.8573,
        "animal_jitter": ANIMAL_JITTER,
    }
    return owners


DEMO_OWNERS = _build_owners()


def _build_registry():
    """Expand the owner directory into individual animals.

    Every animal sits within a few hundred metres of its owner's homestead.
    That tightness is what makes DBSCAN produce readable outbreak clusters in
    the demo rather than a scatter of unclustered single points.
    """
    rng = random.Random(SEED + 1)
    rows = []
    serial = 0
    legacy_counts = {o[0]: o[7] for o in LEGACY_OWNERS}

    for owner_idx, (owner_id, owner) in enumerate(sorted(DEMO_OWNERS.items())):
        if owner_id == LARGE_HOLDER_ID:
            herd_size = LARGE_HOLDER_SIZE
        elif owner_id in legacy_counts:
            herd_size = legacy_counts[owner_id]
        else:
            # Skewed low: most Indian holdings are 2-10 head, a few are larger.
            herd_size = min(MAX_HOLDING, max(2, int(rng.triangular(2, 20, 6))))

        region = REGION_OF_STATE.get(owner["state"], "South")
        state_code = _STATE_CODES.get(owner["state"], 99)
        spread = owner.get("animal_jitter", ANIMAL_JITTER)

        for animal_idx in range(herd_size):
            serial += 1
            species = _pick_species(rng)
            rows.append({
                "pashu_aadhaar": _make_aadhaar(state_code, owner_idx, animal_idx, serial),
                "owner_id": owner_id,
                "owner_name": owner["name"],
                "species": species,
                "breed": rng.choice(BREEDS[region][species]),
                "sex": "Female" if rng.random() < 0.72 else "Male",
                "age_years": round(rng.uniform(0.8, 11.0), 1),
                "village": owner["village"],
                "district": owner["district"],
                "state": owner["state"],
                "latitude": round(owner["lat"] + rng.uniform(-spread, spread), 6),
                "longitude": round(owner["lng"] + rng.uniform(-spread, spread), 6),
            })
    return rows


LIVESTOCK_REGISTRY = _build_registry()

# Legacy tags are the ones printed in the README and used as the API example,
# so they are pinned to their original values rather than regenerated. Applied
# after generation so the structured scheme still allocates their slots.
_LEGACY_TAGS = {
    "farmer_01": ["900412780031", "900412780048", "900412780055", "900412780062"],
    "ravi_kumar": ["900412781017", "900412781024", "900412781031", "900412781048", "900412781055"],
    "lakshmi_devi": ["900412782013", "900412782020", "900412782037", "900412782044"],
    "murugan_s": ["900412783019", "900412783026", "900412783033", "900412783040", "900412783057"],
    "anitha_r": ["900412784015", "900412784022", "900412784039", "900412784046"],
    "karthik_m": ["900412785011", "900412785028", "900412785035", "900412785042"],
    "suresh_gowda": ["910512786018", "910512786025", "910512786032", "910512786049", "910512786056"],
    "bhavani_n": ["910512787014", "910512787021", "910512787038", "910512787045"],
    "iqbal_shaikh": ["910512788010", "910512788027", "910512788034", "910512788041"],
    "sunita_patil": ["920612789016", "920612789023", "920612789030", "920612789047", "920612789054"],
    "arjun_more": ["920612790012", "920612790029", "920612790036", "920612790043"],
}


def _pin_legacy_tags():
    by_owner = {}
    for row in LIVESTOCK_REGISTRY:
        by_owner.setdefault(row["owner_id"], []).append(row)
    for owner_id, tags in _LEGACY_TAGS.items():
        for row, tag in zip(by_owner.get(owner_id, []), tags):
            row["pashu_aadhaar"] = tag


_pin_legacy_tags()


# --- IMPORT-TIME INVARIANTS ---
# These run on every import (including on a Vercel cold start). They are cheap
# and they fail loudly, which is what you want: a malformed registry would
# otherwise surface much later as an unexplained 404 in the form's auto-fill.

_bad = [r["pashu_aadhaar"] for r in LIVESTOCK_REGISTRY
        if not is_valid_pashu_aadhaar(r["pashu_aadhaar"])]
assert not _bad, f"Malformed Pashu Aadhaar numbers in registry: {_bad[:10]}"

_dupes = len(LIVESTOCK_REGISTRY) - len({r["pashu_aadhaar"] for r in LIVESTOCK_REGISTRY})
assert _dupes == 0, f"{_dupes} duplicate Pashu Aadhaar numbers in registry"


def holdings() -> dict:
    """owner_id -> number of animals registered to them."""
    counts = {}
    for row in LIVESTOCK_REGISTRY:
        counts[row["owner_id"]] = counts.get(row["owner_id"], 0) + 1
    return counts


def _assert_holding_limits():
    """At most one owner may hold more than MAX_HOLDING animals."""
    over = {owner: n for owner, n in holdings().items() if n > MAX_HOLDING}
    assert len(over) <= 1, (
        f"At most one owner may hold more than {MAX_HOLDING} animals; "
        f"found {len(over)}: {over}"
    )
    if over:
        assert LARGE_HOLDER_ID in over, (
            f"The only owner allowed over {MAX_HOLDING} is {LARGE_HOLDER_ID}, got {over}"
        )


def _assert_unique_names():
    """One display name maps to exactly one owner_id.

    The >20 holdings rule is stated per person. If two owner_ids shared a
    display name their holdings would read as one person's, and the rule could
    be violated in appearance while holding in the data.
    """
    seen = {}
    for row in LIVESTOCK_REGISTRY:
        prior = seen.setdefault(row["owner_name"], row["owner_id"])
        assert prior == row["owner_id"], (
            f"Display name {row['owner_name']!r} is shared by owner ids "
            f"{prior!r} and {row['owner_id']!r}"
        )


_assert_holding_limits()
_assert_unique_names()

# Convenience aggregates the API and the map legend read.
STATES_COVERED = sorted({r["state"] for r in LIVESTOCK_REGISTRY})
DISTRICTS_COVERED = sorted({(r["state"], r["district"]) for r in LIVESTOCK_REGISTRY})
